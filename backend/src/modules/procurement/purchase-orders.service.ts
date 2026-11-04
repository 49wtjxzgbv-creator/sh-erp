import { Injectable } from '@nestjs/common';
import { CodedBadRequestException, CodedConflictException, CodedNotFoundException } from '../../common/api-exceptions';
import { Prisma } from '@prisma/client';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StockService } from '../inventory/stock.service';
import { ExchangeRatesService } from '../finance/exchange-rates.service';
import { DeliverySchedulesService } from './delivery-schedules.service';
import { PurchaseOrderCommentsService } from './purchase-order-comments.service';
import { SupplierCatalogService } from './supplier-catalog.service';
import { CreatePurchaseOrderDto, QueryPurchaseOrdersDto } from './dto/purchase-order.dto';
import { ReceivePurchaseOrderDto } from './dto/receive-purchase-order.dto';
import { UpdatePurchaseOrderMilestonesDto } from './dto/update-purchase-order-milestones.dto';
import { DeliveryScheduleLinesDto, BulkCreateDeliveryScheduleDto } from './dto/delivery-schedule.dto';
import { FinishedGoodsService } from '../production/finished-goods.service';

/**
 * Multi-line purchase orders with a receiving workflow (PurchaseOrders.gs,
 * Phase 1 §3.4). `receiveFromPurchaseOrder` in the legacy system called the
 * same stock-receiving function the Products page uses — here that's just
 * `StockService.applyMovement` with `type: 'RECEIVE'`, the single path
 * every stock mutation in the system goes through (Module 4's own header
 * comment). Tracks partial delivery via `PurchaseOrderItem.qtyReceived`
 * (atomic increment, same lost-update-avoidance principle as the stock
 * ledger itself) and keeps `actualPrice` distinct from `expectedPrice` so
 * realized cost can differ from what was quoted.
 */
@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly stockService: StockService,
    private readonly deliverySchedulesService: DeliverySchedulesService,
    private readonly commentsService: PurchaseOrderCommentsService,
    private readonly exchangeRatesService: ExchangeRatesService,
    private readonly supplierCatalogService: SupplierCatalogService,
    private readonly finishedGoodsService: FinishedGoodsService,
  ) {}

  async create(user: RequestUser, dto: CreatePurchaseOrderDto) {
    // Multi-currency module phase 4 (2026-10-29) — defaults to this
    // company's own base currency, not a hardcoded EUR.
    const currency = dto.currency ?? (await this.exchangeRatesService.getBaseCurrency(user.companyId));
    const order = await this.prisma.tenant.purchaseOrder.create({
      data: {
        supplierId: dto.supplierId,
        supplierNameSnapshot: dto.supplierNameSnapshot,
        expectedDeliveryDate: dto.expectedDeliveryDate,
        comment: dto.comment,
        sourceCustomerOrderId: dto.sourceCustomerOrderId,
        currency,
        status: 'ORDERED',
        createdById: user.userId,
        items: {
          create: dto.items.map((item) => ({
            productId: item.productId,
            assemblyId: item.assemblyId,
            articleSnapshot: item.articleSnapshot,
            productNameSnapshot: item.productNameSnapshot,
            qtyOrdered: item.qtyOrdered,
            expectedPrice: item.expectedPrice,
            sourceRequirementId: item.sourceRequirementId,
            originatingPurchaseRequestItemId: item.originatingPurchaseRequestItemId,
          })),
        },
      } as any,
      include: { items: true },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'purchase_order.created',
      entityType: 'PurchaseOrder',
      entityId: order.id,
      after: order,
    });

    await this.supplierCatalogService.ensureCatalogEntries(
      user,
      order.supplierId,
      order.items.map((i) => i.productId),
      order.items.map((i) => i.assemblyId),
    );
    return order;
  }

  async findOne(user: RequestUser, id: string) {
    const order = await this.prisma.tenant.purchaseOrder.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            // Full version history (Phase 1) — includes SUPERSEDED/REJECTED
            // rows on purpose, for a transparent audit trail in the UI;
            // `currentDeliveryScheduleId` on the item itself is what marks
            // which one is operative.
            deliverySchedules: { include: { lines: true }, orderBy: { versionNumber: 'asc' } },
          },
        },
      },
    });
    if (!order) throw new CodedNotFoundException('PURCHASE_ORDER_NOT_FOUND', 'Purchase order not found.');
    return order;
  }

  /**
   * Permanent hard delete — admin-only (`purchase-orders:delete`, distinct
   * from the regular `purchase-orders:manage` staff permission). Items
   * cascade at the DB level (PurchaseOrderItem.purchaseOrder is
   * `onDelete: Cascade`, schema.prisma). Any StockMovement already posted
   * from `receive()` is untouched — `StockMovement.sourceId` is a
   * polymorphic soft reference (plain string/uuid, not a real FK), so the
   * physical stock adjustment stays recorded even though the order it came
   * from no longer exists, same as `AuditEvent` never being retroactively
   * altered.
   *
   * Blocked (`PURCHASE_ORDER_HAS_FINANCE_DATA`) once any PurchaseOrderDocument
   * or PurchaseOrderExpense exists — both cascade-delete at the DB level
   * (documents also cascade their own Payments), which would otherwise
   * silently erase recorded finance history with no warning. Caller must
   * delete those first (same guard pattern as warehouses.service.ts and
   * company-units.service.ts).
   */
  async remove(user: RequestUser, id: string) {
    const order = await this.findOne(user, id);
    const [documentCount, expenseCount] = await Promise.all([
      this.prisma.tenant.purchaseOrderDocument.count({ where: { purchaseOrderId: id } }),
      this.prisma.tenant.purchaseOrderExpense.count({ where: { purchaseOrderId: id } }),
    ]);
    if (documentCount > 0 || expenseCount > 0) {
      throw new CodedConflictException(
        'PURCHASE_ORDER_HAS_FINANCE_DATA',
        `Cannot delete: this purchase order has ${documentCount} finance document(s) and ${expenseCount} expense(s). Delete them first.`,
      );
    }
    await this.prisma.tenant.purchaseOrder.delete({ where: { id } });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'purchase_order.deleted',
      entityType: 'PurchaseOrder',
      entityId: id,
      before: order,
    });
  }

  async query(user: RequestUser, query: QueryPurchaseOrdersDto) {
    const where: Prisma.PurchaseOrderWhereInput = {};
    if (query.status) where.status = query.status as any;
    if (query.supplierId) where.supplierId = query.supplierId;

    const take = query.limit ?? 50;
    const skip = query.offset ?? 0;
    const [items, total] = await Promise.all([
      this.prisma.tenant.purchaseOrder.findMany({ where, orderBy: { orderDate: 'desc' }, take, skip }),
      this.prisma.tenant.purchaseOrder.count({ where }),
    ]);
    return { items, total, limit: take, offset: skip };
  }

  /**
   * Records receiving against one or more lines (a partial delivery is
   * just a receive() call whose lines don't cover every item, or whose
   * qtyReceived is less than what remains — receiving the same PO multiple
   * times over its life is the normal case, not an edge case). No cap is
   * enforced against over-receiving beyond qtyOrdered — the legacy system's
   * "no hidden arithmetic" philosophy (Phase 1 §6.3) extends naturally
   * here: record reality, don't silently clamp it.
   */
  async receive(user: RequestUser, id: string, dto: ReceivePurchaseOrderDto) {
    const order = await this.findOne(user, id);
    if (order.status === 'DELIVERED') {
      throw new CodedBadRequestException('PURCHASE_ORDER_ALREADY_DELIVERED', 'This purchase order is already fully delivered.');
    }

    const warehouseId = dto.warehouseId ?? (await this.resolveDefaultWarehouseId());
    const itemsById = new Map<string, any>();
    for (const item of order.items as any[]) {
      itemsById.set(item.id, item);
    }

    for (const line of dto.lines) {
      const item = itemsById.get(line.purchaseOrderItemId);
      if (!item) {
        throw new CodedNotFoundException('PURCHASE_ORDER_ITEM_NOT_FOUND', `Purchase order item ${line.purchaseOrderItemId} does not belong to this order.`);
      }

      await this.prisma.tenant.purchaseOrderItem.update({
        where: { id: item.id },
        data: {
          qtyReceived: { increment: line.qtyReceived },
          ...(line.actualPrice !== undefined ? { actualPrice: line.actualPrice } : {}),
        },
      });

      if (item.productId) {
        // If this line was bought specifically for a customer order (via
        // "Надіслати заявку постачальнику"), that order's outstanding need
        // is topped up first when the movement posts below — see
        // StockService#applyMovement's own comment for why this lives
        // there (the single choke point every stock mutation goes through)
        // rather than as a separate call here.
        const preferredOrderId = item.sourceRequirementId
          ? (await this.prisma.tenant.orderMaterialRequirement.findUnique({ where: { id: item.sourceRequirementId } }))?.customerOrderId
          : undefined;

        await this.stockService.applyMovement(user, {
          productId: item.productId,
          warehouseId,
          type: 'RECEIVE',
          qtyDelta: line.qtyReceived,
          sourceType: 'PurchaseOrder',
          sourceId: order.id,
          comment: `Received against PO ${order.id}, item "${item.articleSnapshot}"`,
          preferredOrderId,
        });

        // An actual receive price is ground truth — it overwrites
        // sellPriceEur (the one cost basis every BOM/valuation calculation
        // in this app is pinned to), same sync point as
        // ProductsService#setSuppliers's default-supplier price.
        if (line.actualPrice !== undefined) {
          await this.prisma.tenant.product.update({
            where: { id: item.productId },
            data: { sellPriceEur: line.actualPrice },
          });
        }
      } else if (item.assemblyId) {
        // "замовлення постачальнику... вироби" (2026-11-04) — a виріб
        // bought whole from a supplier never touches WarehouseStock/
        // StockMovement (Product-only, structurally), it lands in
        // FinishedGood via the same receivePurchased() path the standalone
        // "Оприбуткувати куплене" dialog already uses — see that method's
        // own header comment. One FinishedGood row per unit, so a
        // fractional qty here (PurchaseOrderItem.qtyOrdered is a Decimal)
        // isn't meaningful — reject rather than silently floor/round it.
        if (!Number.isInteger(line.qtyReceived)) {
          throw new CodedBadRequestException(
            'PURCHASE_ORDER_ASSEMBLY_RECEIVE_NOT_INTEGER',
            `Виріб units must be received as a whole number — got ${line.qtyReceived}.`,
          );
        }
        await this.finishedGoodsService.receivePurchased(user, {
          assemblyId: item.assemblyId,
          qty: line.qtyReceived,
          unitCostEur: line.actualPrice ?? Number(item.expectedPrice ?? 0),
          comment: `Отримано за замовленням постачальнику — ${order.supplierNameSnapshot}`,
          sourcePurchaseOrderItemId: item.id,
        });
      }
    }

    const refreshedItems = await this.prisma.tenant.purchaseOrderItem.findMany({ where: { purchaseOrderId: id } });
    const allDelivered = refreshedItems.every((i) => Number(i.qtyReceived) >= Number(i.qtyOrdered));
    const anyReceived = refreshedItems.some((i) => Number(i.qtyReceived) > 0);
    const newStatus = allDelivered ? 'DELIVERED' : anyReceived ? 'PARTIAL' : 'ORDERED';

    const updated = await this.prisma.tenant.purchaseOrder.update({
      where: { id },
      data: { status: newStatus },
      include: { items: true },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'purchase_order.received',
      entityType: 'PurchaseOrder',
      entityId: id,
      after: { status: newStatus, lines: dto.lines },
    });

    return updated;
  }

  /**
   * Склад's "Очікується від постачальника" tab — staff-corrected timeline
   * dates, independent of `status`/`qtyReceived` (see PurchaseOrder's own
   * schema comment). `dto` is passed straight to Prisma like `update()`
   * above: a field the client omitted from the PATCH body isn't present on
   * the transformed DTO instance at all, so it's left untouched; a field
   * sent as `null` (see the DTO's toNullableDate) really does clear it.
   */
  async updateMilestones(user: RequestUser, id: string, dto: UpdatePurchaseOrderMilestonesDto) {
    const before = await this.findOne(user, id);
    const order = await this.prisma.tenant.purchaseOrder.update({ where: { id }, data: dto as any });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'purchase_order.milestones_updated',
      entityType: 'PurchaseOrder',
      entityId: id,
      before: {
        plannedSendAt: before.plannedSendAt,
        sentToSupplierAt: before.sentToSupplierAt,
        shippedBySupplierAt: before.shippedBySupplierAt,
        deliveredAt: before.deliveredAt,
      },
      after: {
        plannedSendAt: order.plannedSendAt,
        sentToSupplierAt: order.sentToSupplierAt,
        shippedBySupplierAt: order.shippedBySupplierAt,
        deliveredAt: order.deliveredAt,
      },
    });

    return order;
  }

  /**
   * Delivery Schedule (Phase 1, 2026-08-21) — creates the first (and only,
   * until a proposal is accepted) version for an item that has none yet.
   * Additive: an item with no schedule keeps using the existing order-level
   * `supplierConfirmedDeliveryDate` mechanism untouched.
   */
  async createDeliverySchedule(user: RequestUser, orderId: string, itemId: string, dto: DeliveryScheduleLinesDto) {
    const order = await this.findOne(user, orderId);
    const item = (order.items as any[]).find((i) => i.id === itemId);
    if (!item) {
      throw new CodedNotFoundException('PURCHASE_ORDER_ITEM_NOT_FOUND', `Purchase order item ${itemId} does not belong to this order.`);
    }
    return this.deliverySchedulesService.createFirstVersion(user.companyId, user.userId, itemId, dto.lines);
  }

  /**
   * "fill once for the group" (2026-11-03) — every PurchaseOrderItem that
   * convertToOrder fanned out from the SAME aggregated заявка line, across
   * however many customer orders it spans. RLS already scopes the lookup
   * to this company; no per-order ownership check is needed beyond that,
   * since any item with a matching originatingPurchaseRequestItemId is by
   * construction a sibling, regardless of which order it landed on.
   */
  async getDeliveryScheduleSiblings(user: RequestUser, itemId: string) {
    const item = await this.prisma.tenant.purchaseOrderItem.findUnique({ where: { id: itemId } });
    if (!item) {
      throw new CodedNotFoundException('PURCHASE_ORDER_ITEM_NOT_FOUND', 'Purchase order item not found.');
    }
    if (!item.originatingPurchaseRequestItemId) return [];

    const siblings = await this.prisma.tenant.purchaseOrderItem.findMany({
      where: { originatingPurchaseRequestItemId: item.originatingPurchaseRequestItemId },
      include: { purchaseOrder: { include: { sourceCustomerOrder: true } } },
    });

    return siblings.map((s) => {
      const order = (s as any).purchaseOrder;
      return {
        id: s.id,
        purchaseOrderId: s.purchaseOrderId,
        productId: s.productId,
        articleSnapshot: s.articleSnapshot,
        productNameSnapshot: s.productNameSnapshot,
        qtyOrdered: s.qtyOrdered,
        currentDeliveryScheduleId: s.currentDeliveryScheduleId,
        customerOrderId: order.sourceCustomerOrderId,
        customerOrderNumber: order.sourceCustomerOrder?.orderNumber ?? null,
        customerOrderDeadline: order.sourceCustomerOrder?.deadline ?? null,
      };
    });
  }

  /**
   * Splits each submitted line's qty proportionally across the group's
   * items by their own qtyOrdered share (remainder to the item whose
   * customer order has the earliest deadline — same rounding convention
   * convertToOrder's fan-out already uses), then calls the existing,
   * unmodified `createFirstVersion` once per item with its derived lines.
   * An item that ends up with zero lines (e.g. its share rounds to 0 on a
   * tiny total) is simply skipped rather than given an empty schedule.
   */
  async createGroupedDeliverySchedule(user: RequestUser, dto: BulkCreateDeliveryScheduleDto) {
    const items = await this.prisma.tenant.purchaseOrderItem.findMany({ where: { id: { in: dto.purchaseOrderItemIds } } });
    if (items.length !== dto.purchaseOrderItemIds.length) {
      throw new CodedNotFoundException('PURCHASE_ORDER_ITEM_NOT_FOUND', 'One or more purchase order items could not be found.');
    }

    const orders = await this.prisma.tenant.purchaseOrder.findMany({
      where: { id: { in: items.map((i) => i.purchaseOrderId) } },
      include: { sourceCustomerOrder: true },
    });
    // Descending by deadline (latest/none first) so the item whose order is
    // MOST urgent (earliest deadline) ends up last and absorbs the
    // rounding remainder — same convention convertToOrder's fan-out uses.
    const deadlineByOrderId = new Map(orders.map((o) => [o.id, (o as any).sourceCustomerOrder?.deadline ?? null]));
    const sortedItems = [...items].sort((a, b) => {
      const deadlineA = deadlineByOrderId.get(a.purchaseOrderId)?.getTime() ?? -Infinity;
      const deadlineB = deadlineByOrderId.get(b.purchaseOrderId)?.getTime() ?? -Infinity;
      return deadlineB - deadlineA;
    });
    const totalWeight = sortedItems.reduce((sum, i) => sum + Number(i.qtyOrdered), 0);

    const linesByItemId = new Map<string, { date: Date; qty: number }[]>(sortedItems.map((i) => [i.id, []]));
    for (const line of dto.lines) {
      let allocated = 0;
      sortedItems.forEach((item, index) => {
        const isLast = index === sortedItems.length - 1;
        const weight = Number(item.qtyOrdered);
        const qty = isLast ? line.qty - allocated : Math.round((weight / totalWeight) * line.qty * 1000) / 1000;
        allocated += qty;
        if (qty <= 0) return;
        linesByItemId.get(item.id)!.push({ date: line.date, qty });
      });
    }

    const schedules = [];
    for (const item of sortedItems) {
      const itemLines = linesByItemId.get(item.id)!;
      if (itemLines.length === 0) continue;
      schedules.push(await this.deliverySchedulesService.createFirstVersion(user.companyId, user.userId, item.id, itemLines));
    }
    return schedules;
  }

  /** Accepts a supplier's PROPOSED delivery schedule — becomes the item's CONFIRMED current version. */
  async acceptDeliverySchedule(user: RequestUser, orderId: string, scheduleId: string) {
    const schedule = await this.findScheduleForOrder(orderId, scheduleId);
    return this.deliverySchedulesService.accept(user.companyId, user.userId, schedule, schedule.purchaseOrderItem.currentDeliveryScheduleId);
  }

  /** Rejects a supplier's PROPOSED delivery schedule — the current version is left untouched. */
  async rejectDeliverySchedule(user: RequestUser, orderId: string, scheduleId: string) {
    const schedule = await this.findScheduleForOrder(orderId, scheduleId);
    return this.deliverySchedulesService.reject(user.companyId, user.userId, schedule);
  }

  /** Verifies scheduleId genuinely belongs to an item on THIS order — RLS already keeps it within this company, this closes the rest of the ownership chain. 404s for a schedule that exists but belongs to a different order, same as everywhere else in this module. */
  private async findScheduleForOrder(orderId: string, scheduleId: string) {
    const schedule = await this.prisma.tenant.deliverySchedule.findUnique({
      where: { id: scheduleId },
      include: { purchaseOrderItem: true },
    });
    if (!schedule || schedule.purchaseOrderItem.purchaseOrderId !== orderId) {
      throw new CodedNotFoundException('DELIVERY_SCHEDULE_NOT_FOUND', 'Delivery schedule not found.');
    }
    return schedule;
  }

  /** Phase 2 — the discussion thread for this order, oldest first. Ownership re-checked via findOne, same pattern as delivery-schedule actions. */
  async listComments(user: RequestUser, orderId: string) {
    await this.findOne(user, orderId);
    return this.commentsService.list(user.companyId, orderId);
  }

  async addComment(user: RequestUser, orderId: string, body: string) {
    await this.findOne(user, orderId);
    return this.commentsService.createByStaff(user.companyId, orderId, user.userId, body);
  }

  private async resolveDefaultWarehouseId(): Promise<string> {
    const warehouse = await this.prisma.tenant.warehouse.findFirst({ where: { isDefault: true, deletedAt: null } });
    if (!warehouse) {
      throw new CodedBadRequestException(
        'PROCUREMENT_NO_DEFAULT_WAREHOUSE',
        'No default warehouse configured and none specified — cannot determine where to receive stock into.',
      );
    }
    return warehouse.id;
  }
}
