import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DeliverySchedulesService } from '../procurement/delivery-schedules.service';
import { RequestSupplierPortalUser } from './supplier-portal-context';
import { ConfirmPurchaseOrderDto } from './dto/confirm-purchase-order.dto';
import { DeliveryScheduleLinesDto } from '../procurement/dto/delivery-schedule.dto';
import { CodedNotFoundException } from '../../common/api-exceptions';

/**
 * The supplier-side view of purchase orders — `this.prisma.tenant` here is
 * already RLS-scoped to `companyId` by `SupplierPortalScopeInterceptor`
 * (same as any other tenant-scoped service), but RLS only enforces the
 * company boundary. The narrower "only THIS supplier's own rows" boundary
 * is an explicit `where: { supplierId }` in every method below — never
 * trust the id in the URL alone (see ADR-0011 §Consequences).
 */
@Injectable()
export class SupplierPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly deliverySchedulesService: DeliverySchedulesService,
  ) {}

  async listPurchaseOrders(actor: RequestSupplierPortalUser) {
    const orders = await this.prisma.tenant.purchaseOrder.findMany({
      where: { supplierId: actor.supplierId },
      orderBy: { orderDate: 'desc' },
      include: { items: true },
    });
    return { items: orders };
  }

  async getPurchaseOrder(actor: RequestSupplierPortalUser, id: string) {
    const order = await this.prisma.tenant.purchaseOrder.findFirst({
      where: { id, supplierId: actor.supplierId },
      include: {
        items: {
          include: {
            deliverySchedules: { include: { lines: true }, orderBy: { versionNumber: 'asc' } },
          },
        },
      },
    });
    // Same id but a different supplier's order (or a nonexistent id) both
    // 404 identically — never distinguish "not yours" from "doesn't exist".
    if (!order) throw new CodedNotFoundException('PURCHASE_ORDER_NOT_FOUND', 'Purchase order not found.');
    return order;
  }

  async confirmPurchaseOrder(actor: RequestSupplierPortalUser, id: string, dto: ConfirmPurchaseOrderDto) {
    const order = await this.getPurchaseOrder(actor, id); // re-checks ownership; throws 404 for anyone else's order

    const itemIds = new Set((order.items as any[]).map((i) => i.id));
    for (const line of dto.items) {
      if (!itemIds.has(line.id)) {
        throw new CodedNotFoundException('SUPPLIER_PORTAL_LINE_NOT_FOUND', `Line ${line.id} does not belong to this purchase order.`);
      }
    }

    await Promise.all(
      dto.items.map((line) =>
        this.prisma.tenant.purchaseOrderItem.update({
          where: { id: line.id },
          data: { supplierConfirmedPrice: line.confirmedPrice },
        }),
      ),
    );

    const updated = await this.prisma.tenant.purchaseOrder.update({
      where: { id },
      data: {
        supplierConfirmedAt: new Date(),
        ...(dto.confirmedDeliveryDate ? { supplierConfirmedDeliveryDate: dto.confirmedDeliveryDate } : {}),
      },
      include: { items: true },
    });

    await this.auditService.record({
      companyId: actor.companyId,
      actorUserId: null, // not a User row — see metadata for who actually did this
      action: 'purchase_order.supplier_confirmed',
      entityType: 'PurchaseOrder',
      entityId: id,
      after: { confirmedDeliveryDate: dto.confirmedDeliveryDate, items: dto.items },
      metadata: { supplierPortalUserId: actor.supplierPortalUserId, supplierId: actor.supplierId },
    });

    return updated;
  }

  /** Confirms the current PENDING delivery schedule as-is (Phase 1). */
  async confirmDeliverySchedule(actor: RequestSupplierPortalUser, orderId: string, scheduleId: string) {
    const schedule = await this.findScheduleForOrder(actor, orderId, scheduleId);
    return this.deliverySchedulesService.confirmAsIs(actor.companyId, actor.supplierPortalUserId, schedule);
  }

  /** Proposes a different split for the current PENDING delivery schedule (Phase 1) — creates a new PROPOSED version alongside it. */
  async proposeDeliverySchedule(actor: RequestSupplierPortalUser, orderId: string, scheduleId: string, dto: DeliveryScheduleLinesDto) {
    const schedule = await this.findScheduleForOrder(actor, orderId, scheduleId);
    return this.deliverySchedulesService.propose(actor.companyId, actor.supplierPortalUserId, schedule, dto.lines);
  }

  /**
   * Full ownership chain for a delivery-schedule action: this supplier's
   * order (`getPurchaseOrder`, already 404s for anyone else's) must contain
   * an item whose schedule history includes `scheduleId` — a scheduleId
   * that exists but belongs to a different order (even within the same
   * company) 404s identically, never confirming it exists elsewhere.
   */
  private async findScheduleForOrder(actor: RequestSupplierPortalUser, orderId: string, scheduleId: string) {
    const order = await this.getPurchaseOrder(actor, orderId);
    for (const item of order.items as any[]) {
      const schedule = (item.deliverySchedules as any[]).find((s) => s.id === scheduleId);
      if (schedule) return schedule;
    }
    throw new CodedNotFoundException('DELIVERY_SCHEDULE_NOT_FOUND', 'Delivery schedule not found.');
  }
}
