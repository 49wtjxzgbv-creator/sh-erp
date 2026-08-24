import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Phase 2 (2026-08-24) — a flat discussion thread per PurchaseOrder, shared
 * by staff (`PurchaseOrdersService`) and Supplier Portal
 * (`SupplierPortalService`), same "one state machine, two callers with
 * their own ownership check in front" shape as `DeliverySchedulesService`
 * (Phase 1). Callers MUST verify the requester actually owns/can-see the
 * order (via their own `findOne`/`getPurchaseOrder`) before calling
 * anything here — this service does not re-check that itself, same
 * division of responsibility Phase 1 established.
 */
@Injectable()
export class PurchaseOrderCommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(companyId: string, purchaseOrderId: string) {
    return this.prisma.tenant.purchaseOrderComment.findMany({
      where: { purchaseOrderId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createByStaff(companyId: string, purchaseOrderId: string, userId: string, body: string) {
    const comment = await this.prisma.tenant.purchaseOrderComment.create({
      data: { companyId, purchaseOrderId, authorType: 'STAFF', authorUserId: userId, body },
    });
    await this.auditService.record({
      companyId,
      actorUserId: userId,
      action: 'purchase_order.comment_added',
      entityType: 'PurchaseOrderComment',
      entityId: comment.id,
      after: comment,
      metadata: { purchaseOrderId },
    });
    return comment;
  }

  async createBySupplier(companyId: string, purchaseOrderId: string, supplierPortalUserId: string, body: string) {
    const comment = await this.prisma.tenant.purchaseOrderComment.create({
      data: { companyId, purchaseOrderId, authorType: 'SUPPLIER', authorSupplierPortalUserId: supplierPortalUserId, body },
    });
    await this.auditService.record({
      companyId,
      actorUserId: null, // not a User row — see metadata for who actually did this, same convention as confirmPurchaseOrder
      action: 'purchase_order.comment_added',
      entityType: 'PurchaseOrderComment',
      entityId: comment.id,
      after: comment,
      metadata: { purchaseOrderId, supplierPortalUserId },
    });
    return comment;
  }
}
