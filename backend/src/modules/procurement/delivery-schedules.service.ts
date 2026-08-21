import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CodedBadRequestException, CodedConflictException, CodedNotFoundException } from '../../common/api-exceptions';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

interface ScheduleLineInput {
  date: Date;
  qty: number;
}

/**
 * Delivery Schedule (Phase 1, 2026-08-21) — versioned multi-date delivery
 * plan per `PurchaseOrderItem`, shared by both the staff (`PurchaseOrdersController`)
 * and Supplier Portal (`SupplierPortalController`) sides: the state machine
 * (create/confirm/propose/accept/reject) is identical either way — only
 * WHO is allowed to call which action, and the ownership check in front of
 * it, differs per caller. Both sides already run inside their own
 * interceptor-opened interactive transaction (`TenantScopeInterceptor` /
 * `SupplierPortalScopeInterceptor`, both via `PrismaService.runInTenantTransaction`),
 * so sequential `this.prisma.tenant.*` calls in one method here are already
 * atomic as a group — if anything below throws, Prisma rolls back
 * everything this request did, so a race-losing accept()/create() can never
 * leave a half-applied status flip.
 *
 * Additive to (never replacing) the existing order-level
 * `PurchaseOrder.supplierConfirmedAt`/`supplierConfirmedDeliveryDate`/
 * `PurchaseOrderItem.supplierConfirmedPrice` mechanism — that stays the
 * source of truth for any item that never gets a DeliverySchedule at all.
 */
@Injectable()
export class DeliverySchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /** Staff-only: creates version 1 for an item that has no schedule yet. */
  async createFirstVersion(companyId: string, actorId: string, purchaseOrderItemId: string, lines: ScheduleLineInput[]) {
    const item = await this.prisma.tenant.purchaseOrderItem.findUnique({ where: { id: purchaseOrderItemId } });
    if (!item) {
      throw new CodedNotFoundException('PURCHASE_ORDER_ITEM_NOT_FOUND', 'Purchase order item not found.');
    }
    if (item.currentDeliveryScheduleId) {
      throw new CodedConflictException('DELIVERY_SCHEDULE_ALREADY_EXISTS', 'This item already has a delivery schedule.');
    }
    this.validateLines(lines, Number(item.qtyOrdered));

    let schedule;
    try {
      schedule = await this.prisma.tenant.deliverySchedule.create({
        data: {
          purchaseOrderItemId,
          versionNumber: 1,
          status: 'PENDING',
          createdById: actorId,
          // `as any` — the static Prisma type for a nested create demands
          // companyId here too. Unlike PurchaseOrdersService#create's own
          // nested items.create (which inherits companyId for free because
          // PurchaseOrderItem.purchaseOrder is a COMPOSITE FK
          // [companyId, purchaseOrderId] on PurchaseOrder), DeliveryScheduleLine's
          // FK to DeliverySchedule is a plain single-column FK — Prisma has
          // no relation-based way to infer companyId for the child, so it
          // must be stamped explicitly here rather than relying on
          // tenantScopingExtension (which only stamps the top-level `data`,
          // never nested relation creates).
          lines: { create: lines.map((l) => ({ date: l.date, qty: l.qty, companyId })) },
        } as any,
        include: { lines: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new CodedConflictException('DELIVERY_SCHEDULE_ALREADY_EXISTS', 'This item already has a delivery schedule.');
      }
      throw err;
    }

    // The @@unique([purchaseOrderItemId, versionNumber]) constraint above
    // already stops two concurrent "create the first version" calls from
    // both succeeding (both hardcode versionNumber=1) — this updateMany is
    // the second half: linking the item's pointer to it, guarded the same
    // conditional-update way (never a bare write).
    const linked = await this.prisma.tenant.purchaseOrderItem.updateMany({
      where: { id: purchaseOrderItemId, currentDeliveryScheduleId: null },
      data: { currentDeliveryScheduleId: schedule.id },
    });
    if (linked.count !== 1) {
      throw new CodedConflictException('DELIVERY_SCHEDULE_ALREADY_EXISTS', 'This item already has a delivery schedule.');
    }

    await this.auditService.record({
      companyId,
      actorUserId: actorId,
      action: 'purchase_order.schedule_created',
      entityType: 'DeliverySchedule',
      entityId: schedule.id,
      after: schedule,
      metadata: { purchaseOrderItemId, versionNumber: schedule.versionNumber },
    });
    return schedule;
  }

  /** Supplier-only: accepts the current PENDING version as-is — no new version, just a status flip. */
  async confirmAsIs(companyId: string, respondedById: string, schedule: { id: string; purchaseOrderItemId: string; status: string }) {
    if (schedule.status !== 'PENDING') {
      throw new CodedNotFoundException('DELIVERY_SCHEDULE_NOT_FOUND', 'This schedule is not awaiting confirmation.');
    }

    const updated = await this.prisma.tenant.deliverySchedule.update({
      where: { id: schedule.id },
      data: { status: 'CONFIRMED', respondedById, respondedAt: new Date() },
      include: { lines: true },
    });

    await this.auditService.record({
      companyId,
      actorUserId: null,
      action: 'purchase_order.schedule_confirmed',
      entityType: 'DeliverySchedule',
      entityId: schedule.id,
      after: updated,
      metadata: { purchaseOrderItemId: schedule.purchaseOrderItemId, supplierPortalUserId: respondedById },
    });
    return updated;
  }

  /**
   * Supplier-only: proposes a different split. Creates a NEW version
   * (PROPOSED) alongside the current one — `currentDeliveryScheduleId`
   * does NOT move here, only `accept()` moves it. The partial unique index
   * `delivery_schedules_one_proposed_per_item` is the real backstop against
   * two concurrent proposals for the same item; the upfront check below
   * just gives a clean error in the common (non-race) case.
   */
  async propose(
    companyId: string,
    respondedById: string,
    schedule: { id: string; purchaseOrderItemId: string; status: string; lines: { qty: Prisma.Decimal | number }[] },
    lines: ScheduleLineInput[],
  ) {
    if (schedule.status !== 'PENDING') {
      throw new CodedConflictException('DELIVERY_SCHEDULE_NOT_PROPOSABLE', 'A proposal can only be made against a schedule still awaiting the initial confirmation.');
    }
    const existingProposal = await this.prisma.tenant.deliverySchedule.findFirst({
      where: { purchaseOrderItemId: schedule.purchaseOrderItemId, status: 'PROPOSED' },
    });
    if (existingProposal) {
      throw new CodedConflictException('DELIVERY_SCHEDULE_PROPOSAL_ALREADY_PENDING', 'A proposal is already awaiting a decision — reject it first.');
    }

    const currentTotal = schedule.lines.reduce((sum, l) => sum + Number(l.qty), 0);
    const proposedTotal = lines.reduce((sum, l) => sum + l.qty, 0);
    this.validateLinesPositive(lines);
    if (Math.abs(proposedTotal - currentTotal) > 1e-6) {
      throw new CodedBadRequestException(
        'DELIVERY_SCHEDULE_QUANTITY_MISMATCH',
        `Proposed total (${proposedTotal}) must exactly match the quantity it replaces (${currentTotal}) — quantity cannot be silently gained or lost.`,
      );
    }

    const versionNumber = await this.nextVersionNumber(schedule.purchaseOrderItemId);
    try {
      const proposed = await this.prisma.tenant.deliverySchedule.create({
        data: {
          purchaseOrderItemId: schedule.purchaseOrderItemId,
          versionNumber,
          status: 'PROPOSED',
          previousVersionId: schedule.id,
          createdById: respondedById, // supplier portal user id — bare column, no FK, same "external actor" shape as AuditEvent.actorUserId
          lines: { create: lines.map((l) => ({ date: l.date, qty: l.qty, companyId })) }, // explicit companyId — see createFirstVersion's comment for why the extension can't stamp this nested create
        } as any,
        include: { lines: true },
      });

      await this.auditService.record({
        companyId,
        actorUserId: null,
        action: 'purchase_order.schedule_proposed',
        entityType: 'DeliverySchedule',
        entityId: proposed.id,
        before: { previousVersionId: schedule.id, lines: schedule.lines },
        after: proposed,
        metadata: { purchaseOrderItemId: schedule.purchaseOrderItemId, supplierPortalUserId: respondedById, versionNumber },
      });
      return proposed;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new CodedConflictException('DELIVERY_SCHEDULE_PROPOSAL_ALREADY_PENDING', 'A proposal is already awaiting a decision — reject it first.');
      }
      throw err;
    }
  }

  /**
   * Staff-only: accepts a PROPOSED version — old current -> SUPERSEDED, new
   * -> CONFIRMED, pointer moves, all atomically. The conditional updateMany
   * on the pointer is checked FIRST and thrown on if it doesn't match
   * exactly one row, before either status flip — but even if it were the
   * other way around, the enclosing per-request transaction rolls back the
   * whole thing on any thrown error, so there's no ordering-dependent
   * partial-write risk either way.
   */
  async accept(companyId: string, actorId: string, schedule: { id: string; purchaseOrderItemId: string; status: string }, currentScheduleId: string | null) {
    if (schedule.status !== 'PROPOSED') {
      throw new CodedNotFoundException('DELIVERY_SCHEDULE_NOT_FOUND', 'This schedule is not a pending proposal.');
    }

    const moved = await this.prisma.tenant.purchaseOrderItem.updateMany({
      where: { id: schedule.purchaseOrderItemId, currentDeliveryScheduleId: currentScheduleId },
      data: { currentDeliveryScheduleId: schedule.id },
    });
    if (moved.count !== 1) {
      throw new CodedConflictException('DELIVERY_SCHEDULE_CONCURRENT_UPDATE', 'The delivery schedule changed concurrently — reload and try again.');
    }

    if (currentScheduleId) {
      await this.prisma.tenant.deliverySchedule.update({ where: { id: currentScheduleId }, data: { status: 'SUPERSEDED' } });
    }
    const updated = await this.prisma.tenant.deliverySchedule.update({
      where: { id: schedule.id },
      data: { status: 'CONFIRMED', respondedById: actorId, respondedAt: new Date() },
      include: { lines: true },
    });

    await this.auditService.record({
      companyId,
      actorUserId: actorId,
      action: 'purchase_order.schedule_accepted',
      entityType: 'DeliverySchedule',
      entityId: schedule.id,
      before: { previousCurrentScheduleId: currentScheduleId },
      after: updated,
      metadata: { purchaseOrderItemId: schedule.purchaseOrderItemId },
    });
    return updated;
  }

  /** Staff-only: rejects a PROPOSED version. The current schedule is never touched — nothing to repair. */
  async reject(companyId: string, actorId: string, schedule: { id: string; purchaseOrderItemId: string; status: string }) {
    if (schedule.status !== 'PROPOSED') {
      throw new CodedNotFoundException('DELIVERY_SCHEDULE_NOT_FOUND', 'This schedule is not a pending proposal.');
    }

    const updated = await this.prisma.tenant.deliverySchedule.update({
      where: { id: schedule.id },
      data: { status: 'REJECTED', respondedById: actorId, respondedAt: new Date() },
      include: { lines: true },
    });

    await this.auditService.record({
      companyId,
      actorUserId: actorId,
      action: 'purchase_order.schedule_rejected',
      entityType: 'DeliverySchedule',
      entityId: schedule.id,
      after: updated,
      metadata: { purchaseOrderItemId: schedule.purchaseOrderItemId },
    });
    return updated;
  }

  private async nextVersionNumber(purchaseOrderItemId: string): Promise<number> {
    const latest = await this.prisma.tenant.deliverySchedule.findFirst({
      where: { purchaseOrderItemId },
      orderBy: { versionNumber: 'desc' },
    });
    return (latest?.versionNumber ?? 0) + 1;
  }

  private validateLinesPositive(lines: ScheduleLineInput[]) {
    if (lines.some((l) => l.qty <= 0)) {
      throw new CodedBadRequestException('DELIVERY_SCHEDULE_INVALID_QUANTITY', 'Every schedule line quantity must be greater than zero.');
    }
  }

  private validateLines(lines: ScheduleLineInput[], qtyOrdered: number) {
    this.validateLinesPositive(lines);
    const total = lines.reduce((sum, l) => sum + l.qty, 0);
    if (total > qtyOrdered + 1e-6) {
      throw new CodedBadRequestException(
        'DELIVERY_SCHEDULE_EXCEEDS_ORDERED',
        `Scheduled quantity (${total}) cannot exceed the ordered quantity (${qtyOrdered}).`,
      );
    }
  }
}
