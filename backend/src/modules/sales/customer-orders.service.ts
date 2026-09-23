import { Injectable } from '@nestjs/common';
import { CodedBadRequestException, CodedNotFoundException } from '../../common/api-exceptions';
import { Prisma } from '@prisma/client';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AssembliesService, ProductionTreeNode } from '../bom/assemblies.service';
import { AuditService } from '../audit/audit.service';
import { StockReservationService } from '../inventory/stock-reservation.service';
import { SubAssemblyReservationService } from '../inventory/sub-assembly-reservation.service';
import { ProductionOrdersService } from '../production/production-orders.service';
import { PayrollArticleLine } from '../hr/payroll.service';
import { FinanceService } from '../finance/finance.service';
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
  /**
   * "Виготовлено" (2026-09-01 user request): count of this node's OWN
   * confirmed FinishedGood units (confirmedByExecutionId NOT NULL) across
   * ITS OWN batches only — deliberately NOT `qtyInStock` (which also
   * counts purchased "Зі складу" stock and isn't order-scoped) and NOT the
   * IN_PROGRESS/unconfirmed count — this is specifically "how much has
   * actually been made AND closed into payroll for this order's own
   * production", same confirmed-only gate `CustomerOrdersService#
   * getOrderProductionUnits`'s READY bucket uses. `Потрібно - produced`
   * (clamped at 0, computed on the frontend) is "залишилось виготовити" —
   * deliberately does NOT net out `qtyClaimedFromStock`
   * (SubAssemblyReservation) the way `laborFundEstimate` does, since a
   * "Зі складу" claim was never something this order intends to actually
   * manufacture in the first place.
   */
  produced: number;
  children: ProductionTreeNodeWithBatches[];
}

/** "Оцінено (за поточними ставками)" breakdown (2026-08-30 user request) — every distinct assembly across every item's full production tree, with its own qtyNeeded/laborFundEstimate at current BOM rates. */
export interface PayrollEstimatedArticleLine {
  assemblyId: string;
  assemblyName: string;
  article: string | null;
  qtyNeeded: number;
  estimatedAmount: number;
}

/** "По працівниках" tab (2026-08-30 user request) — one row per employee who earned PIECEWORK pay on this order, with their own article/qty/amount breakdown. */
export interface PayrollByEmployeeLine {
  employeeId: string;
  employeeName: string;
  totalEarned: number;
  byArticle: PayrollArticleLine[];
}

@Injectable()
export class CustomerOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly productionOrdersService: ProductionOrdersService,
    private readonly assembliesService: AssembliesService,
    private readonly stockReservationService: StockReservationService,
    private readonly subAssemblyReservationService: SubAssemblyReservationService,
    private readonly shortageService: CustomerOrderShortageService,
    private readonly financeService: FinanceService,
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
        customerId: dto.customerId,
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
        salePrice: dto.salePrice,
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
          // "Зі складу" choices from the same dialog — recorded as intent
          // ONLY here (2026-09-23 user request: "замовлення зі статусом
          // нове не мають нічого їсти зі складу"), mirroring
          // plannedSubAssemblies above. Previously claimed immediately via
          // SubAssemblyReservationService, which stole stock away from an
          // order already IN_PRODUCTION; the real claim now happens once
          // THIS order itself flips to IN_PRODUCTION (see
          // claimPlannedSubAssembliesFromStock, called from
          // giveItemToProduction/giveSubAssemblyToProduction).
          plannedSubAssembliesFromStock:
            itemDto.subAssembliesFromStock && itemDto.subAssembliesFromStock.length > 0
              ? (itemDto.subAssembliesFromStock as any)
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

  /**
   * The real counterpart to `plannedSubAssembliesFromStock` (see that
   * field's schema comment) — claims every item's "Зі складу" picks via
   * SubAssemblyReservation for real. Called once, right after this order's
   * status flips NEW -> IN_PRODUCTION (giveItemToProduction/
   * giveSubAssemblyToProduction), never at order creation (2026-09-23 user
   * request).
   */
  private async claimPlannedSubAssembliesFromStock(user: RequestUser, orderId: string): Promise<void> {
    const items = await this.prisma.tenant.customerOrderItem.findMany({ where: { customerOrderId: orderId } });
    for (const item of items as any[]) {
      const picks = (item.plannedSubAssembliesFromStock ?? []) as Array<{ assemblyId: string; qty: number }>;
      for (const pick of picks) {
        await this.subAssemblyReservationService.reserve(user, orderId, pick.assemblyId, pick.qty);
      }
    }
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
    const withCosts = await this.withPriceTotals(user, orders as any[]);
    const withProgress = await this.withProductionProgress(withCosts, orders as any[]);
    return { items: withProgress, total, limit: take, offset: skip };
  }

  /**
   * "% виконано" for the "План виробництва" list (2026-08-30 user request)
   * — batched across the whole page (2 round trips regardless of order/line
   * count), same discipline as withPriceTotals just above. Scoped to each
   * item's OWN top-level batches (customerOrderItemId) — sub-assembly
   * batches (subAssemblyForItemId) aren't counted toward this %, since it
   * measures progress on the ORDERED product itself, not an implementation
   * detail one level down (that's what drilling into "Хід виробництва" is
   * for). "Ready" means confirmedByExecutionId IS NOT NULL — a worker's
   * completion was actually confirmed and paid — regardless of the unit's
   * current status (IN_STOCK/SHIPPED/CONSUMED all still count; once
   * genuinely built and paid for, shipping it away doesn't undo that).
   * Deliberately NOT getItemQuantitySummary's older "completed" (any
   * FinishedGood row, any confirmation state) — kept consistent with this
   * session's Склад "В роботі"/"Готова продукція" split instead.
   */
  private async withProductionProgress<T extends Record<string, any>>(
    orders: T[],
    originalWithItems: Array<{ id: string; items: { id: string; qty: Prisma.Decimal }[] }>,
  ): Promise<Array<T & { percentComplete: number | null }>> {
    const itemsByOrderId = new Map(originalWithItems.map((o) => [o.id, o.items]));
    const allItems = originalWithItems.flatMap((o) => o.items);
    const itemIds = allItems.map((i) => i.id);

    const batches = itemIds.length
      ? await this.prisma.tenant.productionOrder.findMany({
          where: { customerOrderItemId: { in: itemIds } },
          select: { id: true, customerOrderItemId: true },
        })
      : [];
    const batchIdsByItem = new Map<string, string[]>();
    for (const b of batches as any[]) {
      if (!b.customerOrderItemId) continue;
      const arr = batchIdsByItem.get(b.customerOrderItemId) ?? [];
      arr.push(b.id);
      batchIdsByItem.set(b.customerOrderItemId, arr);
    }

    const allBatchIds = (batches as any[]).map((b) => b.id);
    const readyGoods = allBatchIds.length
      ? await this.prisma.tenant.finishedGood.findMany({
          where: { productionOrderId: { in: allBatchIds }, confirmedByExecutionId: { not: null } },
          select: { productionOrderId: true },
        })
      : [];
    const readyCountByBatch = new Map<string, number>();
    for (const g of readyGoods as any[]) {
      readyCountByBatch.set(g.productionOrderId, (readyCountByBatch.get(g.productionOrderId) ?? 0) + 1);
    }

    return orders.map((order) => {
      const items = itemsByOrderId.get(order.id) ?? [];
      let ordered = 0;
      let ready = 0;
      for (const item of items) {
        ordered += Number(item.qty);
        for (const batchId of batchIdsByItem.get(item.id) ?? []) {
          ready += readyCountByBatch.get(batchId) ?? 0;
        }
      }
      const percentComplete = ordered > 0 ? Math.min(100, Math.round((ready / ordered) * 100)) : null;
      return { ...order, percentComplete };
    });
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
    await this.subAssemblyReservationService.releaseAllForOrder(user, id);
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
    await this.subAssemblyReservationService.releaseAllForOrder(user, id);
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
      // Only now, with the order genuinely IN_PRODUCTION, does it actually
      // claim shared stock — see ensureRequirementsAndAutoReserve's own
      // 2026-09-23 doc comment.
      await this.shortageService.ensureRequirementsAndAutoReserve(user, orderId);
      await this.claimPlannedSubAssembliesFromStock(user, orderId);
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
      // Only now, with the order genuinely IN_PRODUCTION, does it actually
      // claim shared stock — see ensureRequirementsAndAutoReserve's own
      // 2026-09-23 doc comment.
      await this.shortageService.ensureRequirementsAndAutoReserve(user, orderId);
      await this.claimPlannedSubAssembliesFromStock(user, orderId);
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

    const tree = await this.assembliesService.getProductionTree(user, item.assemblyId, Number(item.qty), orderId);

    const batches = await this.prisma.tenant.productionOrder.findMany({
      where: { OR: [{ customerOrderItemId: itemId }, { subAssemblyForItemId: itemId }] },
    });
    const batchesByAssembly = new Map<string, typeof batches>();
    for (const b of batches) {
      const list = batchesByAssembly.get(b.assemblyId) ?? [];
      list.push(b);
      batchesByAssembly.set(b.assemblyId, list);
    }

    const batchIds = (batches as any[]).map((b) => b.id);
    const producedGrouped = batchIds.length
      ? await this.prisma.tenant.finishedGood.groupBy({
          by: ['productionOrderId'],
          where: { productionOrderId: { in: batchIds }, confirmedByExecutionId: { not: null } },
          _count: { _all: true },
        })
      : [];
    const producedByBatch = new Map((producedGrouped as any[]).map((g) => [g.productionOrderId as string, g._count._all as number]));

    const plannedList = ((item as any).plannedSubAssemblies ?? []) as Array<{ assemblyId: string; qty: number }>;
    const plannedByAssembly = new Map(plannedList.map((p) => [p.assemblyId, p.qty]));

    const attachBatches = (node: ProductionTreeNode): ProductionTreeNodeWithBatches => {
      const nodeBatches = batchesByAssembly.get(node.assemblyId) ?? [];
      return {
        ...node,
        batches: nodeBatches.map((b) => ({ id: b.id, status: b.status, unitsPlanned: Number(b.unitsPlanned) })),
        planned: plannedByAssembly.get(node.assemblyId) ?? null,
        produced: nodeBatches.reduce((sum, b) => sum + (producedByBatch.get(b.id) ?? 0), 0),
        children: node.children.map(attachBatches),
      };
    };

    return attachBatches(tree);
  }

  /**
   * "Фонд заробітної плати на все замовлення" (2026-08-26 user request):
   * two numbers, same estimated-vs-actual duality as `withPriceTotals`'s
   * cost totals elsewhere on this order —
   *  - `estimated`: every node's own `laborFundEstimate` (live BOM rates,
   *    assembly.laborCostPerUnit x the SHORTFALL not already covered by
   *    THIS order's own "Зі складу" claim from order creation — see
   *    ProductionTreeNode.laborFundEstimate's own 2026-08-31 fix comment;
   *    deliberately NOT live/global stock, so this stays a stable budget
   *    reference rather than drifting down as the order's own production
   *    gets confirmed), summed across every item's FULL production tree —
   *    виріб AND every підвиріб at any depth, not just the top-level line.
   *    Rates are still live (current BOM laborCostPerUnit), only the stock
   *    offset is order-creation-frozen — recomputed fresh every call.
   *  - `estimatedByArticle` (2026-08-30 user request — breakdown under
   *    "Оцінено (за поточними ставками)"): the same walk, but keeping every
   *    distinct assembly's own qtyNeeded (the FULL requirement, not the
   *    stock-adjusted shortfall — useful on its own) and laborFundEstimate
   *    (the shortfall-based one) instead of folding into one number
   *    (collectLaborFundByArticle — same recursion as sumLaborFund). An
   *    assembly reused in more than one branch/item is summed into a single
   *    row, not duplicated.
   *  - `actual`: the REAL committed fund — `laborCostEur` (frozen once a
   *    batch actually starts, production-orders.service.ts's "Cost
   *    freezing") summed across every ProductionOrder batch already tied
   *    to this order, whether via `customerOrderItemId` (an item's own
   *    "give to production" batches) or `subAssemblyForItemId` (a
   *    sub-assembly batch planned at order-creation time) — a PLANNED
   *    batch contributes 0 here (laborCostEur is still null), matching
   *    `getItemProductionTree`'s own batch-matching rule.
   *  - `earnedActual`/`byArticle` (2026-08-30 user request): "скільки вже
   *    зароблено працівниками" — the REAL PayrollEntry ledger (type
   *    PIECEWORK) for this order's batches, not the frozen laborCostEur
   *    estimate above. These two numbers can legitimately differ (piecework
   *    is split across workers by allocation percentage, confirmations can
   *    be partial), so both are returned rather than one replacing the
   *    other. `byArticle` mirrors payroll.service.ts#getPayrollSummaryReport's
   *    (employeeId, assemblyId) breakdown, scoped to just this order and
   *    grouped by article only (no employee split needed here) — the
   *    `assemblyId` for each entry is read straight off `batches` (already
   *    fetched below), no extra ProductionOrder round trip needed unlike
   *    the global report.
   */
  /**
   * "Загальні роботи" (2026-09-11 user request — "у нас є коли створюємо
   * замовлення блок пов'язані позиції замовлень цим ми ж прив'язуємо
   * загальну роботу до замовлення"): `WorkTask`-based PIECEWORK entries have
   * NO `productionOrderId` at all (a `ProductionExecution` is for exactly
   * one of `productionOrderId`/`workTaskId`, never both — see that model's
   * own XOR comment), so they were invisible to every productionOrderId-only
   * fetch below. `WorkTaskItem` (the "Пов'язані позиції замовлень" block
   * shown when creating a general-work task) already links a WorkTask to
   * specific `CustomerOrderItem`s — schema.prisma's own comment on that
   * model flagged it "informational tag... never read by any fund/
   * allocation calculation", which was true until this fix. Joins
   * PayrollEntry -> sourceAllocation -> execution -> workTaskId ->
   * WorkTaskItem.customerOrderItemId, scoped to this order's own items.
   * Every returned entry keeps `productionOrderId: null`.
   *
   * `generalWorkTaskId`/`generalWorkTitle` (2026-09-16 user request —
   * "загальні роботи дописуй що саме за робота, коли створювали їх то
   * прописували"): a flat "Загальні роботи" bucket loses which actual task
   * it was, so both callers now group these by their own `workTaskId`
   * (`wt:<id>`, distinct from the assemblyId-keyed buckets) and label the
   * row with `WorkTask.title` — the same description staff typed in when
   * creating the task — instead of the generic fallback string.
   */
  private async getGeneralWorkPayrollEntries(itemIds: string[]) {
    if (!itemIds.length) return [];
    const workTaskItems = await this.prisma.tenant.workTaskItem.findMany({
      where: { customerOrderItemId: { in: itemIds } },
      select: { workTaskId: true },
    });
    const workTaskIds = Array.from(new Set(workTaskItems.map((w) => w.workTaskId)));
    if (!workTaskIds.length) return [];

    const entries = await this.prisma.tenant.payrollEntry.findMany({
      where: { type: 'PIECEWORK', sourceAllocation: { execution: { workTaskId: { in: workTaskIds } } } },
      include: { sourceAllocation: { include: { execution: { select: { workTaskId: true } } } } },
    });
    const tasks = await this.prisma.tenant.workTask.findMany({ where: { id: { in: workTaskIds } }, select: { id: true, title: true } });
    const titleByTaskId = new Map((tasks as any[]).map((t) => [t.id, t.title as string]));

    return (entries as any[]).map((e) => {
      const generalWorkTaskId = e.sourceAllocation?.execution?.workTaskId ?? null;
      return { ...e, generalWorkTaskId, generalWorkTitle: generalWorkTaskId ? (titleByTaskId.get(generalWorkTaskId) ?? null) : null };
    });
  }

  async getPayrollFundSummary(user: RequestUser, orderId: string) {
    const order = await this.findOne(user, orderId);
    const items = order.items as any[];

    let estimated = 0;
    const estimatedByArticleMap = new Map<string, PayrollEstimatedArticleLine>();
    for (const item of items) {
      const tree = await this.assembliesService.getProductionTree(user, item.assemblyId, Number(item.qty), orderId);
      estimated += sumLaborFund(tree);
      collectLaborFundByArticle(tree, estimatedByArticleMap);
    }
    const estimatedByArticle = Array.from(estimatedByArticleMap.values())
      .map((line) => ({ ...line, qtyNeeded: round2(line.qtyNeeded), estimatedAmount: round2(line.estimatedAmount) }))
      // 2026-09-17 user report ("забери з оцінки вироби які... купили
      // готовими"): laborFundEstimate is already 0 for a node fully covered
      // by this order's own "Зі складу" claim (see ProductionTreeNode's own
      // doc comment) — but the node still made it into the list with a
      // 0 EUR row. Nothing was ever going to be paid for it, so it has no
      // business in an "estimated labor" breakdown at all.
      .filter((line) => line.estimatedAmount > 0)
      .sort((a, b) => (a.article ?? '').localeCompare(b.article ?? ''));

    const itemIds = items.map((i) => i.id);
    const batches = itemIds.length
      ? await this.prisma.tenant.productionOrder.findMany({
          where: { OR: [{ customerOrderItemId: { in: itemIds } }, { subAssemblyForItemId: { in: itemIds } }] },
        })
      : [];
    const actual = batches.reduce((sum, b) => sum + Number((b as any).laborCostEur ?? 0), 0);

    const productionOrderIds = batches.map((b) => b.id);
    const assemblyIdByOrderId = new Map(batches.map((b) => [b.id, (b as any).assemblyId as string]));
    const payrollEntries = productionOrderIds.length
      ? await this.prisma.tenant.payrollEntry.findMany({ where: { type: 'PIECEWORK', productionOrderId: { in: productionOrderIds } } })
      : [];
    const generalWorkEntries = await this.getGeneralWorkPayrollEntries(itemIds);
    const allPayrollEntries = [...payrollEntries, ...generalWorkEntries];

    const assemblyIds = Array.from(new Set(Array.from(assemblyIdByOrderId.values())));
    const assemblies = assemblyIds.length
      ? await this.prisma.tenant.assembly.findMany({ where: { id: { in: assemblyIds } }, select: { id: true, name: true, article: true } })
      : [];
    const assemblyById = new Map((assemblies as any[]).map((a) => [a.id, a]));

    const GENERAL_WORK_KEY = '__general__';
    const byArticleMap = new Map<string, PayrollArticleLine>();
    let earnedActual = 0;
    for (const entry of allPayrollEntries as any[]) {
      const amount = Number(entry.amount);
      earnedActual += amount;
      const assemblyId = entry.productionOrderId ? (assemblyIdByOrderId.get(entry.productionOrderId) ?? null) : null;
      const key = assemblyId ?? (entry.generalWorkTaskId ? `wt:${entry.generalWorkTaskId}` : GENERAL_WORK_KEY);
      if (!byArticleMap.has(key)) {
        const assembly = assemblyId ? assemblyById.get(assemblyId) : null;
        byArticleMap.set(key, { assemblyId, assemblyName: assembly?.name ?? entry.generalWorkTitle ?? null, article: assembly?.article ?? null, unitsProduced: 0, amount: 0 });
      }
      const line = byArticleMap.get(key)!;
      line.unitsProduced += Number(entry.unitsProduced ?? 0);
      line.amount += amount;
    }
    const byArticle = Array.from(byArticleMap.values())
      .map((line) => ({ ...line, unitsProduced: round2(line.unitsProduced), amount: round2(line.amount) }))
      .sort((a, b) => {
        if (a.assemblyId === null) return 1;
        if (b.assemblyId === null) return -1;
        return (a.article ?? '').localeCompare(b.article ?? '');
      });

    return { estimated: round2(estimated), estimatedByArticle, actual: round2(actual), earnedActual: round2(earnedActual), byArticle };
  }

  /**
   * "Прибуток по замовленню" — чистий прибуток = ціна продажу
   * (order.salePrice) мінус ДВА REAL cost buckets (2026-09-12 user
   * correction: production/materials cost deliberately dropped from this
   * formula entirely — an earlier version subtracted it too, but the user
   * explicitly wants only labor + additional expenses netted against sale
   * price here):
   *  - `laborCost`: `getPayrollFundSummary`'s `earnedActual` — the REAL
   *    PayrollEntry (PIECEWORK) ledger (includes "Загальні роботи" tagged to
   *    this order via WorkTaskItem), not the frozen `laborCostEur` BOM-rate
   *    estimate. User's explicit 2026-09-11 choice ("реально виплачено
   *    працівникам").
   *  - `additionalExpenses`: `FinanceService#getCustomerOrderSummary`'s
   *    `additionalExpenses` (primary currency only, same as everywhere else
   *    in Finance — see that summary's own "never blend currencies" rule) —
   *    direct `CustomerOrderExpense` rows. Deliberately does NOT use that
   *    summary's `purchaseCost` (shortage-driven PO material spend) — kept
   *    out of this formula the same as production cost above.
   * Gated behind `customer-orders:view-profit` (controller), same
   * admin-sensitive rationale as `quotations:view-margin` — sale price and
   * margin are exactly the kind of figure that must never leak to an
   * ordinary sales user's screen.
   */
  async getProfitReport(user: RequestUser, orderId: string) {
    const order = await this.findOne(user, orderId);

    const [payrollFund, financeSummary] = await Promise.all([
      this.getPayrollFundSummary(user, orderId),
      this.financeService.getCustomerOrderSummary(user, orderId),
    ]);
    const laborCost = payrollFund.earnedActual;
    const additionalExpenses = financeSummary.additionalExpenses;

    const salePrice = order.salePrice != null ? Number(order.salePrice) : null;
    const netProfit = salePrice != null ? salePrice - laborCost - additionalExpenses : null;

    return {
      salePrice,
      laborCost: round2(laborCost),
      additionalExpenses: round2(additionalExpenses),
      netProfit: netProfit != null ? round2(netProfit) : null,
    };
  }

  /**
   * "По працівниках" tab on План виробництва's order detail (2026-08-30
   * user request — "хто скільки заробив і хто скільки чого зробив"): the
   * same real PayrollEntry (PIECEWORK) ledger `getPayrollFundSummary`
   * already sums into `earnedActual`/`byArticle`, grouped by employee
   * INSTEAD of by article — one row per worker who actually earned
   * something on this order, each with their own total and their own
   * article/qty/amount breakdown (mirrors payroll.service.ts's
   * getPayrollSummaryReport, scoped to just this order's batches rather
   * than a company-wide date range).
   */
  async getOrderPayrollByEmployee(user: RequestUser, orderId: string): Promise<PayrollByEmployeeLine[]> {
    const order = await this.findOne(user, orderId);
    const itemIds = (order.items as any[]).map((i) => i.id);

    const batches = itemIds.length
      ? await this.prisma.tenant.productionOrder.findMany({
          where: { OR: [{ customerOrderItemId: { in: itemIds } }, { subAssemblyForItemId: { in: itemIds } }] },
          select: { id: true, assemblyId: true },
        })
      : [];
    const assemblyIdByOrderId = new Map((batches as any[]).map((b) => [b.id, b.assemblyId as string]));
    const productionOrderIds = (batches as any[]).map((b) => b.id);

    const payrollEntries = productionOrderIds.length
      ? await this.prisma.tenant.payrollEntry.findMany({ where: { type: 'PIECEWORK', productionOrderId: { in: productionOrderIds } } })
      : [];
    const generalWorkEntries = await this.getGeneralWorkPayrollEntries(itemIds);
    const allPayrollEntries = [...payrollEntries, ...generalWorkEntries];
    if (allPayrollEntries.length === 0) return [];

    const employeeIds = Array.from(new Set((allPayrollEntries as any[]).map((e) => e.employeeId as string)));
    const employees = await this.prisma.tenant.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true, fullName: true } });
    const employeeById = new Map((employees as any[]).map((e) => [e.id, e]));

    const assemblyIds = Array.from(new Set(Array.from(assemblyIdByOrderId.values())));
    const assemblies = assemblyIds.length
      ? await this.prisma.tenant.assembly.findMany({ where: { id: { in: assemblyIds } }, select: { id: true, name: true, article: true } })
      : [];
    const assemblyById = new Map((assemblies as any[]).map((a) => [a.id, a]));

    const GENERAL_WORK_KEY = '__general__';
    const linesByEmployee = new Map<string, PayrollByEmployeeLine>();
    const articlesByEmployee = new Map<string, Map<string, PayrollArticleLine>>();
    for (const entry of allPayrollEntries as any[]) {
      const employeeId = entry.employeeId as string;
      if (!linesByEmployee.has(employeeId)) {
        linesByEmployee.set(employeeId, {
          employeeId,
          employeeName: employeeById.get(employeeId)?.fullName ?? employeeId,
          totalEarned: 0,
          byArticle: [],
        });
        articlesByEmployee.set(employeeId, new Map());
      }
      const line = linesByEmployee.get(employeeId)!;
      const amount = Number(entry.amount);
      line.totalEarned += amount;

      const assemblyId = entry.productionOrderId ? (assemblyIdByOrderId.get(entry.productionOrderId) ?? null) : null;
      const key = assemblyId ?? (entry.generalWorkTaskId ? `wt:${entry.generalWorkTaskId}` : GENERAL_WORK_KEY);
      const byArticle = articlesByEmployee.get(employeeId)!;
      if (!byArticle.has(key)) {
        const assembly = assemblyId ? assemblyById.get(assemblyId) : null;
        byArticle.set(key, { assemblyId, assemblyName: assembly?.name ?? entry.generalWorkTitle ?? null, article: assembly?.article ?? null, unitsProduced: 0, amount: 0 });
      }
      const articleLine = byArticle.get(key)!;
      articleLine.unitsProduced += Number(entry.unitsProduced ?? 0);
      articleLine.amount += amount;
    }

    for (const [employeeId, line] of linesByEmployee) {
      line.totalEarned = round2(line.totalEarned);
      line.byArticle = Array.from(articlesByEmployee.get(employeeId)!.values())
        .map((a) => ({ ...a, unitsProduced: round2(a.unitsProduced), amount: round2(a.amount) }))
        .sort((a, b) => {
          if (a.assemblyId === null) return 1;
          if (b.assemblyId === null) return -1;
          return (a.article ?? '').localeCompare(b.article ?? '');
        });
    }

    return Array.from(linesByEmployee.values()).sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  }

  /**
   * "В роботі" / "Що зроблено" tabs on Виробництво → По замовленнях → order
   * detail (2026-08-30 user request) — every FinishedGood unit genuinely
   * traceable to THIS order's production. Unlike getPayrollFundSummary's
   * byArticle (piecework payroll, order-level fund pool) and unlike
   * withProductionProgress's percentComplete (top-level items only), this
   * includes EVERY batch tied to the order at ANY depth — both
   * customerOrderItemId (top-level "give to production") and
   * subAssemblyForItemId (sub-assembly batches) — so a viewer sees the
   * whole tree's real unit-level state, not just the finished top-level
   * product.
   *
   * Deliberately does NOT reuse Склад's `applyFinishedGoodScope` (2026-08-31
   * fix — "у вкладці що зроблено не відображаються підвироби які зробили
   * працівники"): that helper's callers always pre-filter `status:
   * 'IN_STOCK'` (a warehouse view only cares what's physically still on the
   * shelf — once a sub-assembly is consumed into its parent it's correctly
   * gone from Склад entirely). Here a sub-assembly consumed into the SAME
   * order's parent item mid-production is still very much "made for this
   * order" — it just isn't sitting on a shelf anymore. So both buckets
   * share the same status set (IN_STOCK/CONSUMED/SHIPPED — REWORK/DEFECTIVE
   * never count as either) and split purely on `confirmedByExecutionId`:
   *  - READY ("Що зроблено"): confirmed only (2026-08-31 fix — "коректно
   *    відображались вироби які ми реально зробили і закрили в зарплату";
   *    an EARLIER version of this fix counted CONSUMED/SHIPPED unconditionally
   *    the moment they were physically consumed/shipped, even before payroll
   *    was closed for the execution that made them — that read as "done"
   *    before it actually was for accounting purposes).
   *  - IN_PROGRESS ("В роботі"): unconfirmed, regardless of physical status —
   *    a sub-assembly routinely gets CONSUMED by its parent's start() before
   *    a worker gets around to confirming the execution that made it (see
   *    ProductionExecutionsService#stampConfirmedFinishedGoods's own
   *    2026-08-31 fix for the other half of this), so it stays "в роботі"
   *    (payroll not yet closed) rather than vanishing from both tabs.
   */
  async getOrderProductionUnits(user: RequestUser, orderId: string) {
    const order = await this.findOne(user, orderId);
    const itemIds = (order.items as any[]).map((i) => i.id);

    const batches = itemIds.length
      ? await this.prisma.tenant.productionOrder.findMany({
          where: { OR: [{ customerOrderItemId: { in: itemIds } }, { subAssemblyForItemId: { in: itemIds } }] },
        })
      : [];
    const assemblyIdByOrderId = new Map((batches as any[]).map((b) => [b.id, b.assemblyId as string]));
    const batchIds = (batches as any[]).map((b) => b.id);

    const assemblyIds = Array.from(new Set(Array.from(assemblyIdByOrderId.values())));
    const assemblies = assemblyIds.length
      ? await this.prisma.tenant.assembly.findMany({ where: { id: { in: assemblyIds } }, select: { id: true, name: true, article: true } })
      : [];
    const assemblyById = new Map((assemblies as any[]).map((a) => [a.id, a]));

    const buildBucket = async (scope: 'IN_PROGRESS' | 'READY') => {
      if (batchIds.length === 0) return [];
      const where: any = {
        productionOrderId: { in: batchIds },
        status: { in: ['IN_STOCK', 'CONSUMED', 'SHIPPED'] },
        confirmedByExecutionId: scope === 'READY' ? { not: null } : null,
      };
      const grouped = await this.prisma.tenant.finishedGood.groupBy({ by: ['assemblyId'], where, _count: { _all: true } });
      return (grouped as any[])
        .map((g) => {
          const assembly = assemblyById.get(g.assemblyId);
          return { assemblyId: g.assemblyId, assemblyName: assembly?.name ?? null, article: assembly?.article ?? null, qty: g._count._all };
        })
        .sort((a, b) => (a.article ?? '').localeCompare(b.article ?? ''));
    };

    const [inProgress, ready] = await Promise.all([buildBucket('IN_PROGRESS'), buildBucket('READY')]);
    return { inProgress, ready };
  }

  /**
   * "Відвантажити" per order item (2026-09-17 user request — "організуй
   * відвантаження по замовленнях, щоб можна було обрати готові вироби
   * замовлення всі чи частково"): every IN_STOCK FinishedGood unit
   * traceable to THIS order's own top-level items, oldest first (FIFO —
   * same convention ProductionOrdersService's own sub-assembly consumption
   * uses), so the shipment screen can offer "ship N of M ready units" per
   * line instead of making staff hunt through a bare, order-agnostic
   * serial list (frontend/components/domain/sales/finished-good-selector.tsx's
   * older generic picker).
   *
   * Scoped to `customerOrderItemId` ONLY, never `subAssemblyForItemId` — a
   * customer is shipped the ordered виріб itself, never one of its own
   * підвироби (those get consumed into the parent long before shipping,
   * see ProductionOrdersService#start's own FIFO consumption). `status:
   * 'IN_STOCK'` only, matching ShipmentsService#create's own requirement —
   * `confirmedByExecutionId` is deliberately NOT required here: a unit is
   * physically ready to hand to a carrier the moment it's built, regardless
   * of whether payroll has been closed for the execution that made it yet
   * (that gate matters for "Що зроблено"/getOrderProductionUnits above, not
   * for shipping).
   */
  async getShippableGoods(user: RequestUser, orderId: string) {
    const order = await this.findOne(user, orderId);
    const items = order.items as any[];
    const itemIds = items.map((i) => i.id);

    const batches = itemIds.length
      ? await this.prisma.tenant.productionOrder.findMany({ where: { customerOrderItemId: { in: itemIds } }, select: { id: true, customerOrderItemId: true } })
      : [];
    const batchIdsByItemId = new Map<string, string[]>();
    for (const b of batches as any[]) {
      const list = batchIdsByItemId.get(b.customerOrderItemId) ?? [];
      list.push(b.id);
      batchIdsByItemId.set(b.customerOrderItemId, list);
    }
    const allBatchIds = (batches as any[]).map((b) => b.id);
    const goods = allBatchIds.length
      ? await this.prisma.tenant.finishedGood.findMany({
          where: { productionOrderId: { in: allBatchIds }, status: 'IN_STOCK' },
          orderBy: { manufactureDate: 'asc' },
          select: { id: true, serialNumber: true, manufactureDate: true, productionOrderId: true },
        })
      : [];
    const goodsByBatchId = new Map<string, any[]>();
    for (const g of goods as any[]) {
      const list = goodsByBatchId.get(g.productionOrderId as string) ?? [];
      list.push(g);
      goodsByBatchId.set(g.productionOrderId as string, list);
    }

    const assemblyIds = Array.from(new Set(items.map((i) => i.assemblyId)));
    const assemblies = assemblyIds.length
      ? await this.prisma.tenant.assembly.findMany({ where: { id: { in: assemblyIds } }, select: { id: true, name: true, article: true } })
      : [];
    const assemblyById = new Map((assemblies as any[]).map((a) => [a.id, a]));

    return items.map((item) => {
      const batchIds = batchIdsByItemId.get(item.id) ?? [];
      const finishedGoods = batchIds
        .flatMap((id) => goodsByBatchId.get(id) ?? [])
        .sort((a, b) => new Date(a.manufactureDate).getTime() - new Date(b.manufactureDate).getTime());
      const assembly = assemblyById.get(item.assemblyId);
      return {
        itemId: item.id,
        assemblyId: item.assemblyId,
        assemblyName: assembly?.name ?? null,
        article: assembly?.article ?? null,
        qtyOrdered: Number(item.qty),
        qtyAvailable: finishedGoods.length,
        finishedGoods: finishedGoods.map((g) => ({ id: g.id, serialNumber: g.serialNumber, manufactureDate: g.manufactureDate })),
      };
    });
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

/**
 * Walks a production tree (виріб + every підвиріб at any depth), adding
 * each node's OWN qtyNeeded/laborFundEstimate into `map`, keyed by
 * assemblyId — the same assembly can legitimately appear more than once
 * (reused in two branches of one item's tree, or across two different
 * items on the same order), so qty/amount are summed rather than
 * overwritten. Mirrors sumLaborFund's own recursion, just collecting
 * per-node instead of folding into one total.
 */
function collectLaborFundByArticle(node: ProductionTreeNode, map: Map<string, PayrollEstimatedArticleLine>): void {
  const existing = map.get(node.assemblyId);
  if (existing) {
    existing.qtyNeeded += node.qtyNeeded;
    existing.estimatedAmount += node.laborFundEstimate;
  } else {
    map.set(node.assemblyId, {
      assemblyId: node.assemblyId,
      assemblyName: node.name,
      article: node.article,
      qtyNeeded: node.qtyNeeded,
      estimatedAmount: node.laborFundEstimate,
    });
  }
  for (const child of node.children) collectLaborFundByArticle(child, map);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
