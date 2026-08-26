import { Injectable } from '@nestjs/common';
import { CodedBadRequestException, CodedNotFoundException } from '../../common/api-exceptions';
import { Prisma } from '@prisma/client';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AssembliesService, ProductionTreeNode } from '../bom/assemblies.service';
import { AuditService } from '../audit/audit.service';
import { StockReservationService } from '../inventory/stock-reservation.service';
import { ProductionOrdersService } from '../production/production-orders.service';
import { CustomerOrderShortageService } from './customer-order-shortage.service';
import { CreateCustomerOrderDto, QueryCustomerOrdersDto, UpdateCustomerOrderDto } from './dto/customer-order.dto';
import { GiveItemToProductionDto, GiveSubAssemblyToProductionDto } from './dto/give-to-production.dto';

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
export interface ProductionTreeNodeWithBatches extends ProductionTreeNode {
  batches: Array<{ id: string; status: string; unitsPlanned: number }>;
  /** Qty chosen for this node in the order-creation "Підвироби" dialog, if any — null when it wasn't marked "Виготовити" there. Purely a pre-fill hint for GiveNodeToProductionButton; never implies a batch already exists. */
  planned: number | null;
  children: ProductionTreeNodeWithBatches[];
}

@Injectable()
export class CustomerOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly productionOrdersService: ProductionOrdersService,
    private readonly assembliesService: AssembliesService,
    private readonly stockReservationService: StockReservationService,
    private readonly shortageService: CustomerOrderShortageService,
  ) {}

  /**
   * §ensureRequirementsAndAutoReserve (simplified spec, 2026-08-19): by
   * default, every raw material this order needs gets reserved from
   * whatever's already on hand — no manual per-line decision required. Runs
   * after the order (and its items) are committed, in the same request
   * transaction, so a failure here rolls back the whole creation rather
   * than leaving an order with no requirements tracked at all.
   */
  async create(user: RequestUser, dto: CreateCustomerOrderDto) {
    const order = await this.prisma.tenant.customerOrder.create({
      data: {
        orderNumber: dto.orderNumber,
        clientName: dto.clientName,
        contactPerson: dto.contactPerson,
        deadline: dto.deadline,
        priority: dto.priority ?? 'NORMAL',
        plannedStartAt: dto.plannedStartAt,
        plannedCompletionAt: dto.plannedCompletionAt,
        plannedShipmentAt: dto.plannedShipmentAt,
        plannedDeliveryAt: dto.plannedDeliveryAt,
        deliveryCost: dto.deliveryCost,
        transportRiggingCost: dto.transportRiggingCost,
        otherCost: dto.otherCost,
        comment: dto.comment,
        status: 'NEW',
        createdById: user.userId,
      } as any,
    });

    // Items are created one at a time here (rather than Prisma's nested
    // `items: { create: [...] }` array, used before 2026-08-25) so each
    // one's real id is known immediately — needed to link any requested
    // sub-assembly production batches (below) to the SPECIFIC item that
    // needs them, without relying on a returned relation array happening to
    // preserve input order (never a documented guarantee).
    const items = [];
    for (const itemDto of dto.items) {
      const item = await this.prisma.tenant.customerOrderItem.create({
        data: {
          customerOrderId: order.id,
          assemblyId: itemDto.assemblyId,
          qty: itemDto.qty,
          plannedStartAt: itemDto.plannedStartAt,
          plannedEndAt: itemDto.plannedEndAt,
          itemDeadline: itemDto.itemDeadline,
          // Sub-assembly choices from the "Підвироби" dialog (2026-08-27
          // decision): recorded as intent only — NO ProductionOrder is
          // created and the order's status is NOT touched here. Read back
          // by getItemProductionTree to pre-fill each node's "Передати у
          // виробництво" quantity; the batch itself is only ever created
          // once staff click that button in "Хід виробництва".
          plannedSubAssemblies:
            itemDto.subAssembliesToProduce && itemDto.subAssembliesToProduce.length > 0
              ? (itemDto.subAssembliesToProduce as any)
              : undefined,
        } as any,
      });
      items.push(item);
    }

    const fullOrder = { ...order, items };

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'customer_order.created',
      entityType: 'CustomerOrder',
      entityId: order.id,
      after: fullOrder,
    });

    await this.shortageService.ensureRequirementsAndAutoReserve(user, order.id);

    return fullOrder;
  }

  async findOne(user: RequestUser, id: string) {
    const order = await this.prisma.tenant.customerOrder.findUnique({ where: { id }, include: { items: true } });
    if (!order) throw new CodedNotFoundException('CUSTOMER_ORDER_NOT_FOUND', 'Customer order not found.');
    const items = await Promise.all(
      (order.items as any[]).map(async (item) => ({ ...item, quantitySummary: await this.getItemQuantitySummary(item.id, Number(item.qty)) })),
    );
    return { ...order, items };
  }

  /**
   * "Замовлено / У виробництві / Готово / Залишилось передати" (План-графік
   * §1) — ordered is the line's own qty; inProduction sums every non-
   * cancelled batch's unitsPlanned; completed counts actual FinishedGood
   * units those batches produced (IN_STOCK/SHIPPED/CONSUMED — i.e. actually
   * manufactured, not REWORK/DEFECTIVE); remaining is what's left to give
   * to a new batch. CustomerOrderItem.qty and the sum of batch
   * unitsPlanned are deliberately different numbers once a line has
   * multiple batches — never conflated.
   */
  private async getItemQuantitySummary(itemId: string, ordered: number) {
    const batches = await this.prisma.tenant.productionOrder.findMany({
      where: { customerOrderItemId: itemId },
      orderBy: { createdAt: 'asc' },
    });
    const activeBatches = (batches as any[]).filter((b) => b.status !== 'CANCELLED');
    const inProduction = activeBatches.reduce((sum, b) => sum + Number(b.unitsPlanned), 0);
    const batchIds = (batches as any[]).map((b) => b.id);
    const completed = batchIds.length
      ? await this.prisma.tenant.finishedGood.count({
          where: { productionOrderId: { in: batchIds }, status: { in: ['IN_STOCK', 'SHIPPED', 'CONSUMED'] } },
        })
      : 0;
    return {
      ordered,
      inProduction,
      completed,
      remaining: Math.max(ordered - inProduction, 0),
      batches: activeBatches.map((b) => ({ id: b.id, unitsPlanned: Number(b.unitsPlanned), status: b.status, scheduledStartAt: b.scheduledStartAt, scheduledEndAt: b.scheduledEndAt })),
    };
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
  private async withPriceTotals(
    user: RequestUser,
    orders: Array<{
      id: string;
      items: { id: string; assemblyId: string; qty: Prisma.Decimal }[];
      deliveryCost?: Prisma.Decimal | null;
      transportRiggingCost?: Prisma.Decimal | null;
      otherCost?: Prisma.Decimal | null;
    }>,
  ) {
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

    // Actual cost is now summed across every batch (ProductionOrder) linked
    // to a line via customerOrderItemId — a line can have several once
    // split into batches (План-графік §1), unlike the old 1:1
    // productionOrderId this replaces.
    const itemIds = allItems.map((i) => i.id);
    const productionOrders = itemIds.length
      ? await this.prisma.tenant.productionOrder.findMany({ where: { customerOrderItemId: { in: itemIds } } })
      : [];
    const actualCostByItem = new Map<string, number>();
    for (const po of productionOrders as any[]) {
      if (po.totalLocalCostEur != null && po.customerOrderItemId) {
        actualCostByItem.set(po.customerOrderItemId, (actualCostByItem.get(po.customerOrderItemId) ?? 0) + Number(po.totalLocalCostEur));
      }
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
        const actual = actualCostByItem.get(item.id);
        if (actual != null) {
          actualTotal += actual;
          hasActual = true;
        }
      }

      // Extra costs (Продажі's delivery/transport-rigging/other, entered
      // directly by staff, not derived) count toward the order total
      // regardless of production progress — added to both estimated and
      // actual rather than gated behind whether every line resolved a BOM
      // cost, since these are known the moment they're entered.
      const extraCosts =
        Number(order.deliveryCost ?? 0) + Number(order.transportRiggingCost ?? 0) + Number(order.otherCost ?? 0);
      const hasExtraCosts = order.deliveryCost != null || order.transportRiggingCost != null || order.otherCost != null;
      if (hasExtraCosts) {
        estimatedTotal += extraCosts;
        hasEstimate = true;
        actualTotal += extraCosts;
        hasActual = true;
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

  /**
   * §15: cancelling an order releases every active reservation it was
   * holding (one shared pool per product for the whole order — see
   * CustomerOrderShortageService's header comment) — unused reserved stock
   * becomes available to other orders again, physical stock is unchanged
   * (nothing was ever written off just by reserving it). Item-quantity
   * CHANGE (the other half of §15) has no real analog in this system to
   * hook into: CustomerOrderItem lines are immutable once created
   * (UpdateCustomerOrderDto's own header comment — "cancel and recreate for
   * a genuine line change"), so that specific sub-scenario is out of scope
   * here, not silently unhandled.
   */
  async cancel(user: RequestUser, id: string) {
    const order = await this.findOne(user, id);
    if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
      throw new CodedBadRequestException('CUSTOMER_ORDER_CANNOT_CANCEL_TERMINAL', `Cannot cancel a ${order.status} order.`);
    }
    await this.stockReservationService.releaseAllForOrder(user, id);
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
   * Permanent hard delete — admin-only (`customer-orders:delete`, distinct
   * from the regular `customer-orders:manage` staff permission), unlike
   * `cancel()` which just flips status and keeps the record. Every
   * downstream FK from CustomerOrder is `onDelete: SetNull` except
   * CustomerOrderItem's and StockReservation/OrderMaterialRequirement's,
   * which are `Cascade` (schema.prisma) — so this removes the order, its
   * lines, and its reservation records, while any ProductionOrder,
   * FinishedGood, Shipment, or PurchaseOrder that was ever linked to it
   * survives, just orphaned (its own real-world work — material consumed,
   * goods shipped, a supplier committed — doesn't un-happen because the
   * order record is gone). Releasing reservations FIRST (not just letting
   * the DB cascade the rows away) matters: the cascade alone would delete
   * the StockReservation rows but never decrement the separate
   * WarehouseStock.reservedQty counter they were holding, permanently
   * stranding that stock as "reserved" for a customer order that no longer
   * exists. The full `before` snapshot (including items) is captured in the
   * audit trail since this is the one action here that can't be undone by
   * re-fetching the row afterward.
   */
  async remove(user: RequestUser, id: string) {
    const order = await this.findOne(user, id);
    await this.stockReservationService.releaseAllForOrder(user, id);
    await this.prisma.tenant.customerOrder.delete({ where: { id } });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'customer_order.deleted',
      entityType: 'CustomerOrder',
      entityId: id,
      before: order,
    });
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
   * Hands one order line off to production as a new batch (ProductionOrder,
   * via ProductionOrdersService.create). Batch-splitting (План-графік §1):
   * a line can be given repeatedly, each call creating an independent
   * batch with its own qty/dates, as long as some quantity still remains
   * (item.qty minus every non-cancelled batch's unitsPlanned so far).
   * Batches link back to their line via `ProductionOrder.customerOrderItemId`.
   */
  async giveItemToProduction(user: RequestUser, orderId: string, itemId: string, dto: GiveItemToProductionDto) {
    const order = await this.findOne(user, orderId);
    const item = (order.items as any[]).find((i) => i.id === itemId);
    if (!item) throw new CodedNotFoundException('CUSTOMER_ORDER_ITEM_NOT_FOUND', 'This item does not belong to this customer order.');

    const remaining = item.quantitySummary.remaining;
    if (remaining <= 0) {
      throw new CodedBadRequestException('CUSTOMER_ORDER_ITEM_FULLY_IN_PRODUCTION', 'This line\'s full quantity has already been given to production.');
    }
    const unitsPlanned = dto.unitsPlanned ?? Math.ceil(remaining);
    if (unitsPlanned > remaining + 1e-6) {
      throw new CodedBadRequestException(
        'CUSTOMER_ORDER_ITEM_BATCH_EXCEEDS_REMAINING',
        `Batch quantity (${unitsPlanned}) exceeds what remains on this line (${remaining}).`,
      );
    }

    const productionOrder = await this.productionOrdersService.create(user, {
      assemblyId: item.assemblyId,
      unitsPlanned,
      comment: `From customer order ${orderId}, line ${itemId}`,
      scheduledStartAt: dto.scheduledStartAt,
      scheduledEndAt: dto.scheduledEndAt,
      customerOrderItemId: itemId,
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
      after: { productionOrderId: productionOrder.id, unitsPlanned },
    });

    return { item, productionOrder };
  }

  /**
   * "Хід виробництва" per-node give-to-production (2026-08-27 user
   * request) — replaces the old upfront-at-creation sub-assembly planning
   * dialog: nothing is planned by default anymore, every node of the
   * item's production tree (getItemProductionTree) shows its own "Передати
   * у виробництво" button, callable independently at any depth. Same
   * mechanism the old dialog used under the hood (subAssemblyForItemId,
   * never customerOrderItemId — see that field's schema comment), just
   * triggered on demand instead of bundled into order creation.
   */
  async giveSubAssemblyToProduction(user: RequestUser, orderId: string, itemId: string, dto: GiveSubAssemblyToProductionDto) {
    const order = await this.findOne(user, orderId);
    const item = (order.items as any[]).find((i) => i.id === itemId);
    if (!item) throw new CodedNotFoundException('CUSTOMER_ORDER_ITEM_NOT_FOUND', 'This item does not belong to this customer order.');

    const productionOrder = await this.productionOrdersService.create(user, {
      assemblyId: dto.assemblyId,
      unitsPlanned: dto.qty,
      subAssemblyForItemId: itemId,
    });

    if (order.status === 'NEW') {
      await this.prisma.tenant.customerOrder.update({ where: { id: orderId }, data: { status: 'IN_PRODUCTION' } });
    }

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'customer_order_item.sub_assembly_given_to_production',
      entityType: 'CustomerOrderItem',
      entityId: itemId,
      after: { productionOrderId: productionOrder.id, assemblyId: dto.assemblyId, qty: dto.qty },
    });

    return productionOrder;
  }

  /**
   * "Хід виробництва" (2026-08-25 user request): this item's full BOM tree
   * (AssembliesService#getProductionTree — parent виріб -> підвироби ->
   * their own підвироби, recursively), with every node also carrying
   * whichever ProductionOrder batches already exist for it — matched via
   * EITHER customerOrderItemId (the item's own top-level assembly, "give to
   * production") OR subAssemblyForItemId (a sub-assembly batch planned at
   * order-creation time, see that field's schema comment) — both point at
   * the same `itemId`, so one query covers the whole tree regardless of
   * depth. Lets staff see, at a glance, what's already on the shelf
   * (green), what still needs producing (grey), and whether a batch is
   * already planned for it (so they know what to actually click "start" on
   * next, rather than accidentally creating a duplicate batch).
   */
  async getItemProductionTree(user: RequestUser, orderId: string, itemId: string) {
    const order = await this.findOne(user, orderId);
    const item = (order.items as any[]).find((i) => i.id === itemId);
    if (!item) throw new CodedNotFoundException('CUSTOMER_ORDER_ITEM_NOT_FOUND', 'This item does not belong to this customer order.');

    const tree = await this.assembliesService.getProductionTree(user, item.assemblyId, Number(item.qty));

    const batches = await this.prisma.tenant.productionOrder.findMany({
      where: { OR: [{ customerOrderItemId: itemId }, { subAssemblyForItemId: itemId }] },
    });
    const batchesByAssembly = new Map<string, typeof batches>();
    for (const b of batches) {
      const list = batchesByAssembly.get(b.assemblyId) ?? [];
      list.push(b);
      batchesByAssembly.set(b.assemblyId, list);
    }

    const plannedList = ((item as any).plannedSubAssemblies ?? []) as Array<{ assemblyId: string; qty: number }>;
    const plannedByAssembly = new Map(plannedList.map((p) => [p.assemblyId, p.qty]));

    const attachBatches = (node: ProductionTreeNode): ProductionTreeNodeWithBatches => ({
      ...node,
      batches: (batchesByAssembly.get(node.assemblyId) ?? []).map((b) => ({ id: b.id, status: b.status, unitsPlanned: Number(b.unitsPlanned) })),
      planned: plannedByAssembly.get(node.assemblyId) ?? null,
      children: node.children.map(attachBatches),
    });

    return attachBatches(tree);
  }

  /**
   * "Фонд заробітної плати на все замовлення" (2026-08-26 user request):
   * two numbers, same estimated-vs-actual duality as `withPriceTotals`'s
   * cost totals elsewhere on this order —
   *  - `estimated`: every node's own `laborFundEstimate` (live BOM rates,
   *    assembly.laborCostPerUnit x qtyNeeded), summed across every item's
   *    FULL production tree — виріб AND every підвиріб at any depth, not
   *    just the top-level line. Never frozen; recomputed fresh every call.
   *  - `actual`: the REAL committed fund — `laborCostEur` (frozen once a
   *    batch actually starts, production-orders.service.ts's "Cost
   *    freezing") summed across every ProductionOrder batch already tied
   *    to this order, whether via `customerOrderItemId` (an item's own
   *    "give to production" batches) or `subAssemblyForItemId` (a
   *    sub-assembly batch planned at order-creation time) — a PLANNED
   *    batch contributes 0 here (laborCostEur is still null), matching
   *    `getItemProductionTree`'s own batch-matching rule.
   */
  async getPayrollFundSummary(user: RequestUser, orderId: string) {
    const order = await this.findOne(user, orderId);
    const items = order.items as any[];

    let estimated = 0;
    for (const item of items) {
      const tree = await this.assembliesService.getProductionTree(user, item.assemblyId, Number(item.qty));
      estimated += sumLaborFund(tree);
    }

    const itemIds = items.map((i) => i.id);
    const batches = itemIds.length
      ? await this.prisma.tenant.productionOrder.findMany({
          where: { OR: [{ customerOrderItemId: { in: itemIds } }, { subAssemblyForItemId: { in: itemIds } }] },
        })
      : [];
    const actual = batches.reduce((sum, b) => sum + Number((b as any).laborCostEur ?? 0), 0);

    return { estimated: round2(estimated), actual: round2(actual) };
  }

  /**
   * Whole-order variant (Phase 1 §6.2's `createProductionOrdersFromCustomerOrder`)
   * — calls `giveItemToProduction` for every line that still has remaining
   * (not-yet-given) quantity, giving each its full remaining amount as one
   * batch. Safe to call repeatedly — lines with nothing left to give are
   * silently skipped, not re-processed.
   */
  async giveAllToProduction(user: RequestUser, orderId: string) {
    const order = await this.findOne(user, orderId);
    const results = [];
    for (const item of order.items as any[]) {
      if (item.quantitySummary.remaining <= 0) continue;
      results.push(await this.giveItemToProduction(user, orderId, item.id, {}));
    }
    return results;
  }
}

function sumLaborFund(node: ProductionTreeNode): number {
  return node.laborFundEstimate + node.children.reduce((sum, child) => sum + sumLaborFund(child), 0);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
