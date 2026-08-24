import { Injectable } from '@nestjs/common';
import { CodedBadRequestException, CodedNotFoundException } from '../../common/api-exceptions';
import { Prisma } from '@prisma/client';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StockService } from '../inventory/stock.service';
import { DeliverySchedulesService } from './delivery-schedules.service';
import { PurchaseOrderCommentsService } from './purchase-order-comments.service';
import { CreatePurchaseOrderDto, QueryPurchaseOrdersDto } from './dto/purchase-order.dto';
import { ReceivePurchaseOrderDto } from './dto/receive-purchase-order.dto';
import { UpdatePurchaseOrderMilestonesDto } from './dto/update-purchase-order-milestones.dto';
import { DeliveryScheduleLinesDto } from './dto/delivery-schedule.dto';

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
  ) {}

  async create(user: RequestUser, dto: CreatePurchaseOrderDto) {
    const order = await this.prisma.tenant.purchaseOrder.create({
      data: {
        supplierId: dto.supplierId,
        supplierNameSnapshot: dto.supplierNameSnapshot,
        expectedDeliveryDate: dto.expectedDeliveryDate,
        comment: dto.comment,
        sourceCustomerOrderId: dto.sourceCustomerOrderId,
        status: 'ORDERED',
        createdById: user.userId,
        items: {
          create: dto.items.map((item) => ({
            productId: item.productId,
            articleSnapshot: item.articleSnapshot,
            productNameSnapshot: item.productNameSnapshot,
            qtyOrdered: item.qtyOrdered,
            expectedPrice: item.expectedPrice,
            sourceRequirementId: item.sourceRequirementId,
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
   */
  async remove(user: RequestUser, id: string) {
    const order = await this.findOne(user, id);
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
