import { Injectable } from '@nestjs/common';
import { CodedBadRequestException, CodedNotFoundException } from '../../common/api-exceptions';
import { Prisma } from '@prisma/client';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AssembliesService } from '../bom/assemblies.service';
import { AuditService } from '../audit/audit.service';
import { ProductionOrdersService } from '../production/production-orders.service';
import { CreateCustomerOrderDto, QueryCustomerOrdersDto, UpdateCustomerOrderDto } from './dto/customer-order.dto';
import { GiveItemToProductionDto } from './dto/give-to-production.dto';

/**
 * CustomerOrders.gs (Phase 1 §3.4/§6.2). Order header + line items, and the
 * "give to production" staged workflow: a line can be handed off to
 * production individually (`giveItemToProduction`) or the whole order at
 * once (`giveAllToProduction`, which simply calls the former for every
 * not-yet-given line) — Phase 1 §6.2 calls this "poetapne" (staged), a
 * deliberate feature, not an incidental side effect. Recursive shortage
 * analysis lives in `CustomerOrderShortageService`, kept separate because
 * it's the single most algorithmically involved piece of this module
 * (Phase 1 §3.4) and deserves its own focused file.
 */
@Injectable()
export class CustomerOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly productionOrdersService: ProductionOrdersService,
    private readonly assembliesService: AssembliesService,
  ) {}

  async create(user: RequestUser, dto: CreateCustomerOrderDto) {
    const order = await this.prisma.tenant.customerOrder.create({
      data: {
        orderNumber: dto.orderNumber,
        clientName: dto.clientName,
        contactPerson: dto.contactPerson,
        deadline: dto.deadline,
        priority: dto.priority ?? 'NORMAL',
        comment: dto.comment,
        status: 'NEW',
        createdById: user.userId,
        items: {
          create: dto.items.map((item) => ({ assemblyId: item.assemblyId, qty: item.qty })),
        },
      } as any,
      include: { items: true },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'customer_order.created',
      entityType: 'CustomerOrder',
      entityId: order.id,
      after: order,
    });
    return order;
  }

  async findOne(user: RequestUser, id: string) {
    const order = await this.prisma.tenant.customerOrder.findUnique({ where: { id }, include: { items: true } });
    if (!order) throw new CodedNotFoundException('CUSTOMER_ORDER_NOT_FOUND', 'Customer order not found.');
    return order;
  }

  async query(user: RequestUser, query: QueryCustomerOrdersDto) {
    const where: Prisma.CustomerOrderWhereInput = {};
    if (query.status) where.status = query.status as any;
    if (query.search) where.clientName = { contains: query.search, mode: 'insensitive' };

    const take = query.limit ?? 50;
    const skip = query.offset ?? 0;
    const [orders, total] = await Promise.all([
      this.prisma.tenant.customerOrder.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip, include: { items: true } }),
      this.prisma.tenant.customerOrder.count({ where }),
    ]);
    return { items: await this.withPriceTotals(user, orders as any[]), total, limit: take, offset: skip };
  }

  /**
   * Adds `estimatedTotal`/`actualTotal` to each order header for the list
   * view — same estimated-vs-actual split the detail page computes per
   * line (estimated = current BOM cost × qty, never frozen; actual = the
   * linked ProductionOrder's totalLocalCostEur once it has actually
   * started, null until then), just pre-aggregated server-side here
   * because a page of orders means a page of *different* assemblies, and
   * doing that fan-out from the browser (one request per line per order)
   * doesn't scale the way it does for a single order's handful of lines.
   * Batched to 2 round trips total regardless of how many orders/lines are
   * on the page: one cost calculation per *unique* assembly (not per
   * line), one findMany for every referenced ProductionOrder.
   */
  private async withPriceTotals(user: RequestUser, orders: Array<{ id: string; items: { assemblyId: string; qty: Prisma.Decimal; productionOrderId: string | null }[] }>) {
    const allItems = orders.flatMap((o) => o.items);

    const uniqueAssemblyIds = Array.from(new Set(allItems.map((i) => i.assemblyId)));
    const costByAssembly = new Map<string, number>();
    await Promise.all(
      uniqueAssemblyIds.map(async (assemblyId) => {
        try {
          const cost = await this.assembliesService.calculateCost(user, assemblyId);
          costByAssembly.set(assemblyId, cost.costPerUnit);
        } catch {
          // e.g. assembly has no saved BOM version yet — left out of the map, treated as "no estimate" below
        }
      }),
    );

    const productionOrderIds = Array.from(new Set(allItems.map((i) => i.productionOrderId).filter((id): id is string => Boolean(id))));
    const productionOrders = productionOrderIds.length
      ? await this.prisma.tenant.productionOrder.findMany({ where: { id: { in: productionOrderIds } } })
      : [];
    const actualCostByProductionOrder = new Map<string, number>();
    for (const po of productionOrders as any[]) {
      if (po.totalLocalCostEur != null) actualCostByProductionOrder.set(po.id, Number(po.totalLocalCostEur));
    }

    return orders.map((order) => {
      let estimatedTotal = 0;
      let hasEstimate = false;
      let actualTotal = 0;
      let hasActual = false;
      for (const item of order.items) {
        const unitCost = costByAssembly.get(item.assemblyId);
        if (unitCost != null) {
          estimatedTotal += unitCost * Number(item.qty);
          hasEstimate = true;
        }
        if (item.productionOrderId) {
          const actual = actualCostByProductionOrder.get(item.productionOrderId);
          if (actual != null) {
            actualTotal += actual;
            hasActual = true;
          }
        }
      }
      const { items, ...header } = order as any;
      return { ...header, estimatedTotal: hasEstimate ? estimatedTotal : null, actualTotal: hasActual ? actualTotal : null };
    });
  }

  /** Header-only — item lines are immutable once created (see the DTO's own comment). */
  async update(user: RequestUser, id: string, dto: UpdateCustomerOrderDto) {
    const before = await this.findOne(user, id);
    const order = await this.prisma.tenant.customerOrder.update({ where: { id }, data: dto as any });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'customer_order.updated',
      entityType: 'CustomerOrder',
      entityId: id,
      before,
      after: order,
    });
    return order;
  }

  async cancel(user: RequestUser, id: string) {
    const order = await this.findOne(user, id);
    if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
      throw new CodedBadRequestException('CUSTOMER_ORDER_CANNOT_CANCEL_TERMINAL', `Cannot cancel a ${order.status} order.`);
    }
    const updated = await this.prisma.tenant.customerOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'customer_order.cancelled',
      entityType: 'CustomerOrder',
      entityId: id,
      before: order,
      after: updated,
    });
    return updated;
  }

  /**
   * Manual completion — the legacy documentation doesn't specify an
   * automatic trigger (e.g. "every line shipped") for this transition, so
   * rather than invent one, completion is an explicit staff action.
   */
  async complete(user: RequestUser, id: string) {
    const order = await this.findOne(user, id);
    if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
      throw new CodedBadRequestException('CUSTOMER_ORDER_CANNOT_COMPLETE_TERMINAL', `Cannot complete a ${order.status} order.`);
    }
    const updated = await this.prisma.tenant.customerOrder.update({ where: { id }, data: { status: 'COMPLETED' } });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'customer_order.completed',
      entityType: 'CustomerOrder',
      entityId: id,
      before: order,
      after: updated,
    });
    return updated;
  }

  /**
   * Hands one order line off to production — reserves a ProductionOrder
   * for that line's assembly (via ProductionOrdersService.create, Module 6)
   * and locks `CustomerOrderItem.productionOrderId` onto it. A line can
   * only be given once; calling this again for an already-given line is
   * rejected rather than silently creating a second ProductionOrder.
   */
  async giveItemToProduction(user: RequestUser, orderId: string, itemId: string, dto: GiveItemToProductionDto) {
    const order = await this.findOne(user, orderId);
    const item = (order.items as any[]).find((i) => i.id === itemId);
    if (!item) throw new CodedNotFoundException('CUSTOMER_ORDER_ITEM_NOT_FOUND', 'This item does not belong to this customer order.');
    if (item.productionOrderId) {
      throw new CodedBadRequestException('CUSTOMER_ORDER_ITEM_ALREADY_IN_PRODUCTION', 'This line has already been given to production.');
    }

    const productionOrder = await this.productionOrdersService.create(user, {
      assemblyId: item.assemblyId,
      unitsPlanned: dto.unitsPlanned ?? Math.ceil(Number(item.qty)),
      comment: `From customer order ${orderId}, line ${itemId}`,
    });

    await this.prisma.tenant.customerOrderItem.update({
      where: { id: itemId },
      data: { productionOrderId: productionOrder.id },
    });

    if (order.status === 'NEW') {
      await this.prisma.tenant.customerOrder.update({ where: { id: orderId }, data: { status: 'IN_PRODUCTION' } });
    }

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'customer_order_item.given_to_production',
      entityType: 'CustomerOrderItem',
      entityId: itemId,
      after: { productionOrderId: productionOrder.id },
    });

    return { item: { ...item, productionOrderId: productionOrder.id }, productionOrder };
  }

  /**
   * Whole-order variant (Phase 1 §6.2's `createProductionOrdersFromCustomerOrder`)
   * — just calls `giveItemToProduction` for every line that hasn't been
   * given yet. Safe to call repeatedly as new lines are added or as staff
   * decide to stage the rest later — already-given lines are silently
   * skipped, not re-processed.
   */
  async giveAllToProduction(user: RequestUser, orderId: string) {
    const order = await this.findOne(user, orderId);
    const results = [];
    for (const item of order.items as any[]) {
      if (item.productionOrderId) continue;
      results.push(await this.giveItemToProduction(user, orderId, item.id, {}));
    }
    return results;
  }
}
