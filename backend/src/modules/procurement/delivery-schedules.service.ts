import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CodedBadRequestException, CodedConflictException, CodedNotFoundException } from '../../common/api-exceptions';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../notifications/email.service';

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
  private readonly logger = new Logger(DeliverySchedulesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly emailService: EmailService,
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
    await this.notify(purchaseOrderItemId, 'created');
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
    await this.notify(schedule.purchaseOrderItemId, 'confirmed');
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
      await this.notify(schedule.purchaseOrderItemId, 'proposed');
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
    await this.notify(schedule.purchaseOrderItemId, 'accepted');
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
    await this.notify(schedule.purchaseOrderItemId, 'rejected');
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

  /**
   * Phase 2 — email the OTHER side whenever a delivery schedule changes
   * state, so nobody has to poll by logging in (the biggest gap identified
   * in the Phase 2 audit). Synchronous, inside the same per-request
   * transaction as everything else in this class — deliberately NOT a
   * background job (no BullMQ/worker exists yet, ADR-0005 undone; a job
   * running outside request context with no `app.current_company_id` set
   * is exactly the risk class the Phase 1 RLS audit was about). Best-effort:
   * a failed lookup or a failed send is logged and swallowed, never lets a
   * notification problem fail the actual state change it's reporting on —
   * `EmailService.send` itself already fails open when SMTP isn't
   * configured (logs instead of throwing).
   */
  private async notify(purchaseOrderItemId: string, event: 'created' | 'confirmed' | 'proposed' | 'accepted' | 'rejected'): Promise<void> {
    try {
      const item = await this.prisma.tenant.purchaseOrderItem.findUnique({
        where: { id: purchaseOrderItemId },
        include: { purchaseOrder: true },
      });
      if (!item) return;
      const order = (item as any).purchaseOrder;
      const label = item.articleSnapshot;

      // Staff-initiated events (created/accepted/rejected) notify the
      // supplier; supplier-initiated events (confirmed/proposed) notify
      // staff — always the OTHER side, never the actor who just acted.
      const notifySupplier = event === 'created' || event === 'accepted' || event === 'rejected';

      if (notifySupplier) {
        if (!order.supplierId) return;
        const connection = await this.prisma.tenant.supplierConnection.findUnique({ where: { supplierId: order.supplierId } });
        if (!connection) return;
        const portalUser = await this.prisma.tenant.supplierPortalUser.findUnique({ where: { supplierOrganizationId: connection.supplierOrganizationId } });
        if (!portalUser) return;
        await this.emailService.send(portalUser.email, this.subjectFor(event), this.bodyFor(event, label));
      } else {
        const staffUser = await this.prisma.tenant.user.findUnique({ where: { id: order.createdById } });
        if (!staffUser) return;
        await this.emailService.send(staffUser.email, this.subjectFor(event), this.bodyFor(event, label));
      }
    } catch (err) {
      this.logger.warn(`Failed to send delivery-schedule notification (event=${event}, item=${purchaseOrderItemId}): ${err}`);
    }
  }

  private subjectFor(event: 'created' | 'confirmed' | 'proposed' | 'accepted' | 'rejected'): string {
    switch (event) {
      case 'created':
        return 'Новий графік поставки очікує підтвердження — SH ERP';
      case 'confirmed':
        return 'Постачальник підтвердив графік поставки — SH ERP';
      case 'proposed':
        return 'Постачальник запропонував зміни до графіка поставки — SH ERP';
      case 'accepted':
        return 'Вашу пропозицію прийнято — SH ERP';
      case 'rejected':
        return 'Вашу пропозицію відхилено — SH ERP';
    }
  }

  private bodyFor(event: 'created' | 'confirmed' | 'proposed' | 'accepted' | 'rejected', articleLabel: string): string {
    switch (event) {
      case 'created':
        return `Виробник створив графік поставки для позиції "${articleLabel}". Увійдіть у портал постачальника, щоб підтвердити або запропонувати зміни.`;
      case 'confirmed':
        return `Постачальник підтвердив графік поставки для позиції "${articleLabel}" без змін.`;
      case 'proposed':
        return `Постачальник запропонував інший розподіл поставки для позиції "${articleLabel}". Увійдіть у систему, щоб прийняти або відхилити пропозицію.`;
      case 'accepted':
        return `Виробник прийняв вашу пропозицію щодо графіка поставки для позиції "${articleLabel}".`;
      case 'rejected':
        return `Виробник відхилив вашу пропозицію щодо графіка поставки для позиції "${articleLabel}" — попередній графік лишається чинним.`;
    }
  }
}
