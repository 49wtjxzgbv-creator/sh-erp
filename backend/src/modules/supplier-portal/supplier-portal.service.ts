import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DeliverySchedulesService } from '../procurement/delivery-schedules.service';
import { PurchaseOrderCommentsService } from '../procurement/purchase-order-comments.service';
import { FilesService } from '../files/files.service';
import { EmailService } from '../notifications/email.service';
import type { RequestUser } from '../../common/decorators/current-user.decorator';
import { RequestSupplierPortalUser } from './supplier-portal-context';
import { ConfirmPurchaseOrderDto } from './dto/confirm-purchase-order.dto';
import { DeliveryScheduleLinesDto } from '../procurement/dto/delivery-schedule.dto';
import { SupplierPortalUploadDto } from './dto/supplier-portal-upload.dto';
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
  private readonly logger = new Logger(SupplierPortalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly deliverySchedulesService: DeliverySchedulesService,
    private readonly commentsService: PurchaseOrderCommentsService,
    private readonly filesService: FilesService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * `FilesService`'s methods are typed against the staff `RequestUser` shape
   * (`{userId, companyId, email, roleId}`) but only ever read `companyId`/
   * `userId` off it (for the storage key + `uploadedById`/audit actor) — the
   * ambient RLS scoping that actually protects the query comes from
   * `SupplierPortalScopeInterceptor`'s own transaction, same as every other
   * `this.prisma.tenant` call in this class. `uploadedById` is a bare
   * column with no FK (see `FileAsset` schema comment), so storing a
   * `SupplierPortalUserId` there is exactly the same "external actor"
   * pattern already used for `DeliverySchedule.respondedById`.
   */
  private asFilesActor(actor: RequestSupplierPortalUser): RequestUser {
    return { userId: actor.supplierPortalUserId, companyId: actor.companyId, email: '', roleId: '' };
  }

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

    await this.notifyStaffOrderConfirmed(order.createdById, order.id);
    return updated;
  }

  /** Phase 2 — best-effort email to the order's creator, same swallow-and-log shape as DeliverySchedulesService#notify. */
  private async notifyStaffOrderConfirmed(createdById: string, orderId: string): Promise<void> {
    try {
      const staffUser = await this.prisma.tenant.user.findUnique({ where: { id: createdById } });
      if (!staffUser) return;
      await this.emailService.send(
        staffUser.email,
        'Постачальник підтвердив замовлення — SH ERP',
        `Постачальник підтвердив ціни та/або дату постачання по замовленню ${orderId}. Увійдіть у систему, щоб переглянути деталі.`,
      );
    } catch (err) {
      this.logger.warn(`Failed to send order-confirmed notification (order=${orderId}): ${err}`);
    }
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

  /** Phase 2 — documents a supplier (or staff) has attached to this order. Ownership re-checked via getPurchaseOrder. */
  async listFiles(actor: RequestSupplierPortalUser, orderId: string) {
    await this.getPurchaseOrder(actor, orderId);
    return this.filesService.listForEntity(this.asFilesActor(actor), 'PurchaseOrder', orderId, ['PURCHASE_INVOICE']);
  }

  /** Presigned-upload for a document attached to this order — domain/entityType/entityId are pinned here, never client-supplied (see SupplierPortalUploadDto). */
  async createFileUpload(actor: RequestSupplierPortalUser, orderId: string, dto: SupplierPortalUploadDto) {
    await this.getPurchaseOrder(actor, orderId);
    return this.filesService.createPresignedUpload(this.asFilesActor(actor), {
      domain: 'PURCHASE_INVOICE',
      entityType: 'PurchaseOrder',
      entityId: orderId,
      originalName: dto.originalName,
      mimeType: dto.mimeType,
      sizeBytes: dto.sizeBytes,
    });
  }

  async confirmFileUpload(actor: RequestSupplierPortalUser, orderId: string, fileAssetId: string) {
    await this.getPurchaseOrder(actor, orderId);
    await this.assertFileBelongsToOrder(fileAssetId, orderId);
    return this.filesService.confirmUpload(this.asFilesActor(actor), fileAssetId);
  }

  async getFileDownloadUrl(actor: RequestSupplierPortalUser, orderId: string, fileAssetId: string) {
    await this.getPurchaseOrder(actor, orderId);
    await this.assertFileBelongsToOrder(fileAssetId, orderId);
    return this.filesService.getDownloadUrl(this.asFilesActor(actor), fileAssetId);
  }

  /**
   * Extra ownership check beyond FilesService's own RLS scoping: a
   * fileAssetId that exists in this company but belongs to a DIFFERENT
   * entity (another order, a product photo) must not be reachable through
   * this order's endpoints — 404, same "never confirm it exists elsewhere"
   * convention as findScheduleForOrder.
   */
  private async assertFileBelongsToOrder(fileAssetId: string, orderId: string): Promise<void> {
    const fileAsset = await this.prisma.tenant.fileAsset.findUnique({ where: { id: fileAssetId } });
    if (!fileAsset || fileAsset.entityType !== 'PurchaseOrder' || fileAsset.entityId !== orderId) {
      throw new CodedNotFoundException('FILE_NOT_FOUND', 'File not found.');
    }
  }

  /** Phase 2 — this order's discussion thread. Ownership re-checked via getPurchaseOrder, same pattern as everything else here. */
  async listComments(actor: RequestSupplierPortalUser, orderId: string) {
    await this.getPurchaseOrder(actor, orderId);
    return this.commentsService.list(actor.companyId, orderId);
  }

  async addComment(actor: RequestSupplierPortalUser, orderId: string, body: string) {
    await this.getPurchaseOrder(actor, orderId);
    return this.commentsService.createBySupplier(actor.companyId, orderId, actor.supplierPortalUserId, body);
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
