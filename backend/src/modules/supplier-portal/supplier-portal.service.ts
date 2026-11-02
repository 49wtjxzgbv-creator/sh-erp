import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DeliverySchedulesService } from '../procurement/delivery-schedules.service';
import { PurchaseOrderCommentsService } from '../procurement/purchase-order-comments.service';
import { FilesActor, FilesService } from '../files/files.service';
import { EmailService } from '../notifications/email.service';
import { RequestSupplierPortalUser } from './supplier-portal-context';
import { ConfirmPurchaseOrderDto } from './dto/confirm-purchase-order.dto';
import { DeliveryScheduleLinesDto } from '../procurement/dto/delivery-schedule.dto';
import { SupplierPortalUploadDto } from './dto/supplier-portal-upload.dto';
import { QuotePurchaseRequestDto } from './dto/quote-purchase-request.dto';
import { UpdateSupplierCatalogEntryDto } from './dto/update-supplier-catalog-entry.dto';
import { CodedBadRequestException, CodedNotFoundException } from '../../common/api-exceptions';

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
   * `FilesService` only needs `{userId, companyId}` (`FilesActor`) — the
   * ambient RLS scoping that actually protects the query comes from
   * `SupplierPortalScopeInterceptor`'s own transaction, same as every other
   * `this.prisma.tenant` call in this class. `uploadedById` is a bare
   * column with no FK (see `FileAsset` schema comment), so storing a
   * `SupplierPortalUserId` there is exactly the same "external actor"
   * pattern already used for `DeliverySchedule.respondedById`.
   */
  private asFilesActor(actor: RequestSupplierPortalUser): FilesActor {
    return { userId: actor.supplierPortalUserId, companyId: actor.companyId };
  }

  /**
   * "у порталі постачальника перед артикулом має бути фото товару"
   * (2026-11-02) — same PRODUCT_PHOTO lookup PurchaseRequestPdfService
   * already does for the generated PDF (`item.photoUrl`), just reused for
   * the live portal views instead of a static document. Detail views
   * only (not the dashboard list — no per-line article column there to
   * put a photo next to), so this isn't paid on every dashboard load.
   */
  private async attachPhotoUrls<T extends { productId: string | null }>(
    actor: RequestSupplierPortalUser,
    items: T[],
  ): Promise<(T & { photoUrl: string | null })[]> {
    const productIds = [...new Set(items.map((i) => i.productId).filter((v): v is string => v != null))];
    const photos = productIds.length > 0 ? await this.filesService.listForEntities(this.asFilesActor(actor), 'Product', productIds, ['PRODUCT_PHOTO']) : {};
    return items.map((item) => ({
      ...item,
      photoUrl: item.productId ? ((photos as any)[item.productId]?.[0]?.downloadUrl ?? null) : null,
    }));
  }

  /**
   * "також мають додаватися вкладені файли" (2026-11-02) — resolves
   * PurchaseRequestItem.attachedFileIds (the same per-line product
   * documents PurchaseRequestPdfService merges into the generated PDF) to
   * downloadable links, so the supplier can get them straight from the
   * live portal view instead of only ever through a one-off PDF. A
   * missing/deleted id (stale selection, or the product's document was
   * removed since) is silently dropped rather than surfaced as an error —
   * same "don't fabricate, just omit" convention as the PDF renderer's own
   * best-effort attachment merge.
   */
  private async attachAttachedFiles<T extends { attachedFileIds: string[] }>(
    actor: RequestSupplierPortalUser,
    items: T[],
  ): Promise<(T & { attachedFiles: { id: string; originalName: string; downloadUrl: string }[] })[]> {
    const allIds = [...new Set(items.flatMap((i) => i.attachedFileIds))];
    const files = allIds.length > 0 ? await this.filesService.listByIds(this.asFilesActor(actor), allIds) : [];
    const byId = new Map(files.map((f) => [f.id, f]));
    return items.map((item) => ({
      ...item,
      attachedFiles: item.attachedFileIds.map((id) => byId.get(id)).filter((f): f is NonNullable<typeof f> => f != null),
    }));
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
    return { ...order, items: await this.attachPhotoUrls(actor, order.items) };
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

    await this.notifyStaff(
      order.createdById,
      'Постачальник підтвердив замовлення — SH ERP',
      `Постачальник підтвердив ціни та/або дату постачання по замовленню ${order.id}. Увійдіть у систему, щоб переглянути деталі.`,
    );
    return updated;
  }

  /** Phase 2 — best-effort email to a staff member, same swallow-and-log shape as DeliverySchedulesService#notify. Shared by every supplier-action-notifies-staff path in this service (PO confirmed, PR quoted). */
  private async notifyStaff(staffUserId: string, subject: string, text: string): Promise<void> {
    try {
      const staffUser = await this.prisma.tenant.user.findUnique({ where: { id: staffUserId } });
      if (!staffUser) return;
      await this.emailService.send(staffUser.email, subject, text);
    } catch (err) {
      this.logger.warn(`Failed to send staff notification (staffUserId=${staffUserId}, subject=${subject}): ${err}`);
    }
  }

  /**
   * Supplier-portal exposure for PurchaseRequest ("заявка на прорахунок",
   * 2026-11-02) — same direct-prisma-query style as listPurchaseOrders/
   * getPurchaseOrder rather than delegating to PurchaseRequestsService
   * (which lives in ProcurementModule and stays staff-only). DRAFT is
   * excluded from both list and get — that status means staff hasn't
   * decided to send it yet, so it must be invisible (and un-enumerable,
   * same 404-not-403 convention) to the supplier.
   */
  async listPurchaseRequests(actor: RequestSupplierPortalUser) {
    const items = await this.prisma.tenant.purchaseRequest.findMany({
      where: { supplierId: actor.supplierId, status: { not: 'DRAFT' } },
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    });
    return { items };
  }

  async getPurchaseRequest(actor: RequestSupplierPortalUser, id: string) {
    const request = await this.prisma.tenant.purchaseRequest.findFirst({
      where: { id, supplierId: actor.supplierId, status: { not: 'DRAFT' } },
      include: { items: true },
    });
    if (!request) throw new CodedNotFoundException('PURCHASE_REQUEST_NOT_FOUND', 'Purchase request not found.');
    const withPhotos = await this.attachPhotoUrls(actor, request.items);
    return { ...request, items: await this.attachAttachedFiles(actor, withPhotos) };
  }

  /** Supplier submits (or re-submits) a per-line quote. Only while SENT — once converted/cancelled the negotiation is over. */
  async quotePurchaseRequest(actor: RequestSupplierPortalUser, id: string, dto: QuotePurchaseRequestDto) {
    const request = await this.getPurchaseRequest(actor, id); // re-checks ownership+visibility; throws 404 for anyone else's or a DRAFT request

    if (request.status !== 'SENT') {
      throw new CodedBadRequestException('SUPPLIER_PORTAL_REQUEST_NOT_OPEN', 'This purchase request is no longer open for quoting.');
    }

    const itemIds = new Set((request.items as any[]).map((i) => i.id));
    for (const line of dto.items) {
      if (!itemIds.has(line.id)) {
        throw new CodedNotFoundException('SUPPLIER_PORTAL_LINE_NOT_FOUND', `Line ${line.id} does not belong to this purchase request.`);
      }
    }

    await Promise.all(
      dto.items.map((line) =>
        this.prisma.tenant.purchaseRequestItem.update({
          where: { id: line.id },
          data: { supplierQuotedPrice: line.quotedPrice },
        }),
      ),
    );

    const updated = await this.prisma.tenant.purchaseRequest.update({
      where: { id },
      data: { supplierRespondedAt: new Date() },
      include: { items: true },
    });

    await this.auditService.record({
      companyId: actor.companyId,
      actorUserId: null, // not a User row — see metadata for who actually did this
      action: 'purchase_request.supplier_quoted',
      entityType: 'PurchaseRequest',
      entityId: id,
      after: { items: dto.items },
      metadata: { supplierPortalUserId: actor.supplierPortalUserId, supplierId: actor.supplierId },
    });

    await this.notifyStaff(
      request.createdById,
      'Постачальник надіслав ціни — SH ERP',
      `Постачальник надіслав ціни по заявці на прорахунок ${request.number}. Увійдіть у систему, щоб переглянути деталі.`,
    );
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

  /**
   * "у портала постачальника також має бути свій каталог товарів" (2026-11-02)
   * — every product ever sent to this supplier via a PurchaseOrder or sent
   * PurchaseRequest accumulates here (populated by
   * SupplierCatalogService#ensureCatalogEntries), backed by the same
   * `ProductSupplier` rows staff's own Suppliers pages use. `toSupplierCatalogEntry`
   * builds an entirely new response object rather than spreading the raw
   * row — `price`/`isDefault` (staff's own) are structurally impossible to
   * leak here, only the two fields the supplier themselves entered go out.
   */
  private toSupplierCatalogEntry(
    entry: {
      id: string;
      productId: string;
      supplierCostPrice: unknown;
      supplierOfferedPrice: unknown;
      createdAt: Date;
      product: {
        article: string;
        name: string;
        weightPerUnitKg: unknown;
        cuttingSpec: {
          kind: string;
          stockLengthCm: unknown;
          stockWidthCm: unknown;
          defaultCutLengthCm: unknown;
          defaultCutWidthCm: unknown;
          defaultCutShapePolygon: unknown;
        } | null;
      };
    },
    photoUrl: string | null,
    files: { id: string; originalName: string; downloadUrl: string }[],
  ) {
    return {
      id: entry.id,
      productId: entry.productId,
      article: entry.product.article,
      name: entry.product.name,
      weightPerUnitKg: entry.product.weightPerUnitKg,
      photoUrl,
      files,
      cuttingSpec: entry.product.cuttingSpec
        ? {
            kind: entry.product.cuttingSpec.kind,
            stockLengthCm: entry.product.cuttingSpec.stockLengthCm,
            stockWidthCm: entry.product.cuttingSpec.stockWidthCm,
            defaultCutLengthCm: entry.product.cuttingSpec.defaultCutLengthCm,
            defaultCutWidthCm: entry.product.cuttingSpec.defaultCutWidthCm,
            defaultCutShapePolygon: entry.product.cuttingSpec.defaultCutShapePolygon,
          }
        : null,
      supplierCostPrice: entry.supplierCostPrice,
      supplierOfferedPrice: entry.supplierOfferedPrice,
      createdAt: entry.createdAt,
    };
  }

  async listCatalog(actor: RequestSupplierPortalUser) {
    const entries = await this.prisma.tenant.productSupplier.findMany({
      where: { supplierId: actor.supplierId },
      orderBy: { createdAt: 'desc' },
      include: { product: { include: { cuttingSpec: true } } },
    });
    const productIds = entries.map((e) => e.productId);
    const photos = productIds.length > 0 ? await this.filesService.listForEntities(this.asFilesActor(actor), 'Product', productIds, ['PRODUCT_PHOTO']) : {};
    return { items: entries.map((e) => this.toSupplierCatalogEntry(e as any, (photos as any)[e.productId]?.[0]?.downloadUrl ?? null, [])) };
  }

  async getCatalogEntry(actor: RequestSupplierPortalUser, id: string) {
    const entry = await this.prisma.tenant.productSupplier.findFirst({
      where: { id, supplierId: actor.supplierId },
      include: { product: { include: { cuttingSpec: true } } },
    });
    if (!entry) throw new CodedNotFoundException('SUPPLIER_CATALOG_ENTRY_NOT_FOUND', 'Catalog entry not found.');

    const [photos, documents] = await Promise.all([
      this.filesService.listForEntities(this.asFilesActor(actor), 'Product', [entry.productId], ['PRODUCT_PHOTO']),
      this.filesService.listForEntities(this.asFilesActor(actor), 'Product', [entry.productId], ['PRODUCT_DOCUMENT']),
    ]);
    const photoUrl = (photos as any)[entry.productId]?.[0]?.downloadUrl ?? null;
    const files = ((documents as any)[entry.productId] ?? []).map((f: any) => ({ id: f.id, originalName: f.originalName, downloadUrl: f.downloadUrl }));

    return this.toSupplierCatalogEntry(entry as any, photoUrl, files);
  }

  /** Supplier edits their own two fields — ownership-checked the same way as every other mutation here; never touches `price`/`isDefault`. */
  async updateCatalogEntry(actor: RequestSupplierPortalUser, id: string, dto: UpdateSupplierCatalogEntryDto) {
    const entry = await this.prisma.tenant.productSupplier.findFirst({ where: { id, supplierId: actor.supplierId } });
    if (!entry) throw new CodedNotFoundException('SUPPLIER_CATALOG_ENTRY_NOT_FOUND', 'Catalog entry not found.');

    await this.prisma.tenant.productSupplier.update({
      where: { id },
      data: { supplierCostPrice: dto.supplierCostPrice, supplierOfferedPrice: dto.supplierOfferedPrice },
    });

    await this.auditService.record({
      companyId: actor.companyId,
      actorUserId: null, // not a User row — see metadata for who actually did this
      action: 'product_supplier.catalog_updated',
      entityType: 'ProductSupplier',
      entityId: id,
      after: { supplierCostPrice: dto.supplierCostPrice, supplierOfferedPrice: dto.supplierOfferedPrice },
      metadata: { supplierPortalUserId: actor.supplierPortalUserId, supplierId: actor.supplierId },
    });

    return this.getCatalogEntry(actor, id);
  }
}
