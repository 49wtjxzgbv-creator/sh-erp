import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DeliverySchedulesService } from '../procurement/delivery-schedules.service';
import { PurchaseOrderCommentsService } from '../procurement/purchase-order-comments.service';
import { FilesActor, FilesService } from '../files/files.service';
import { EmailService } from '../notifications/email.service';
import { FinanceService } from '../finance/finance.service';
import { RequestSupplierPortalUser } from './supplier-portal-context';
import { ConfirmPurchaseOrderDto } from './dto/confirm-purchase-order.dto';
import { DeliveryScheduleLinesDto } from '../procurement/dto/delivery-schedule.dto';
import { SupplierPortalUploadDto } from './dto/supplier-portal-upload.dto';
import { QuotePurchaseRequestDto } from './dto/quote-purchase-request.dto';
import { UpdateSupplierCatalogEntryDto } from './dto/update-supplier-catalog-entry.dto';
import { UpdateSupplierReadyQtyDto } from './dto/update-supplier-ready-qty.dto';
import { CreateSupplierInvoiceDocumentDto, CreateSupplierInvoicePaymentDto } from '../finance/dto/supplier-finance.dto';
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
    private readonly financeService: FinanceService,
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

  // ---------------------------------------------------------------------
  // "Фінанси" (2026-11-05) — supplier-uploaded invoices. Thin delegates to
  // FinanceService's own supplier-scoped methods (ownership is enforced
  // there, not here — see that service's own header comment above
  // listDocumentsForSupplier); this class only adds the file-attachment
  // endpoints, same 3-step presigned-upload shape as listFiles/
  // createFileUpload/confirmFileUpload/getFileDownloadUrl above, just
  // pointed at domain FINANCE_DOCUMENT / entityType "PurchaseOrderDocument"
  // instead of PURCHASE_INVOICE / "PurchaseOrder".
  // ---------------------------------------------------------------------

  async listFinanceDocuments(actor: RequestSupplierPortalUser) {
    return { items: await this.financeService.listDocumentsForSupplier(actor.supplierId) };
  }

  async getFinanceDocument(actor: RequestSupplierPortalUser, id: string) {
    return this.financeService.getDocumentForSupplier(actor.supplierId, id);
  }

  async createFinanceDocument(actor: RequestSupplierPortalUser, dto: CreateSupplierInvoiceDocumentDto) {
    return this.financeService.createDocumentAsSupplier(actor.companyId, actor.supplierId, actor.supplierPortalUserId, dto);
  }

  async addFinancePayment(actor: RequestSupplierPortalUser, documentId: string, dto: CreateSupplierInvoicePaymentDto) {
    return this.financeService.addPaymentAsSupplier(actor.companyId, actor.supplierId, actor.supplierPortalUserId, documentId, dto);
  }

  async listFinanceDocumentFiles(actor: RequestSupplierPortalUser, documentId: string) {
    await this.getFinanceDocument(actor, documentId); // ownership + INVOICE-type check
    return this.filesService.listForEntity(this.asFilesActor(actor), 'PurchaseOrderDocument', documentId, ['FINANCE_DOCUMENT']);
  }

  async createFinanceDocumentFileUpload(actor: RequestSupplierPortalUser, documentId: string, dto: SupplierPortalUploadDto) {
    await this.getFinanceDocument(actor, documentId);
    return this.filesService.createPresignedUpload(this.asFilesActor(actor), {
      domain: 'FINANCE_DOCUMENT',
      entityType: 'PurchaseOrderDocument',
      entityId: documentId,
      originalName: dto.originalName,
      mimeType: dto.mimeType,
      sizeBytes: dto.sizeBytes,
    });
  }

  async confirmFinanceDocumentFileUpload(actor: RequestSupplierPortalUser, documentId: string, fileAssetId: string) {
    await this.getFinanceDocument(actor, documentId);
    await this.assertFileBelongsToFinanceDocument(fileAssetId, documentId);
    return this.filesService.confirmUpload(this.asFilesActor(actor), fileAssetId);
  }

  async getFinanceDocumentFileDownloadUrl(actor: RequestSupplierPortalUser, documentId: string, fileAssetId: string) {
    await this.getFinanceDocument(actor, documentId);
    await this.assertFileBelongsToFinanceDocument(fileAssetId, documentId);
    return this.filesService.getDownloadUrl(this.asFilesActor(actor), fileAssetId);
  }

  /** Same "never confirm it exists elsewhere" convention as assertFileBelongsToOrder, just for the FINANCE_DOCUMENT/PurchaseOrderDocument pointer instead. */
  private async assertFileBelongsToFinanceDocument(fileAssetId: string, documentId: string): Promise<void> {
    const fileAsset = await this.prisma.tenant.fileAsset.findUnique({ where: { id: fileAssetId } });
    if (!fileAsset || fileAsset.entityType !== 'PurchaseOrderDocument' || fileAsset.entityId !== documentId) {
      throw new CodedNotFoundException('FILE_NOT_FOUND', 'File not found.');
    }
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
    files: unknown[],
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

  /**
   * "щоб візуально був як у виробника також з можливістю перегляду 3д
   * моделі та ар на телефоні" (2026-11-02) — the full, unmapped FileAsset
   * rows `filesService.listForEntities` already returns (storageKey,
   * mimeType, conversionStatus, convertedDownloadUrl,
   * optimizedDownloadUrl, mobileOptimizedDownloadUrl,
   * arOptimizedDownloadUrl, ...) pass straight through as `files` now,
   * same shape the main `/catalog` page's own `View3DButton`/`ArViewButton`
   * already consume there — no truncation to {id, originalName,
   * downloadUrl} anymore, that would silently drop every field those two
   * components actually need.
   */
  async listCatalog(actor: RequestSupplierPortalUser) {
    const entries = await this.prisma.tenant.productSupplier.findMany({
      where: { supplierId: actor.supplierId },
      orderBy: { createdAt: 'desc' },
      include: { product: { include: { cuttingSpec: true } } },
    });
    const productIds = entries.map((e) => e.productId);
    const [photos, documents] =
      productIds.length > 0
        ? await Promise.all([
            this.filesService.listForEntities(this.asFilesActor(actor), 'Product', productIds, ['PRODUCT_PHOTO']),
            this.filesService.listForEntities(this.asFilesActor(actor), 'Product', productIds, ['PRODUCT_DOCUMENT']),
          ])
        : [{}, {}];
    return {
      items: entries.map((e) =>
        this.toSupplierCatalogEntry(e as any, (photos as any)[e.productId]?.[0]?.downloadUrl ?? null, (documents as any)[e.productId] ?? []),
      ),
    };
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
    const files = (documents as any)[entry.productId] ?? [];

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

  /**
   * Shared backing query for the dashboard summary and "План виробництва"
   * (2026-11-02) — every one of this supplier's OPEN orders (not yet fully
   * DELIVERED), with each item's currently-operative delivery schedule (if
   * any) and that schedule's own lines. Written once rather than
   * duplicated between the two callers.
   */
  private async getOpenOrderItems(actor: RequestSupplierPortalUser) {
    return this.prisma.tenant.purchaseOrder.findMany({
      where: { supplierId: actor.supplierId, status: { not: 'DELIVERED' } },
      include: {
        items: {
          include: {
            currentDeliverySchedule: { include: { lines: true } },
          },
        },
      },
    });
  }

  /**
   * "План виробництва" (2026-11-02) — every upcoming delivery obligation
   * across ALL of this supplier's open orders, flattened to one row per
   * (date, qty) commitment and sorted soonest-first. For an item with a
   * negotiated delivery schedule, one row per DeliveryScheduleLine of the
   * current version (PENDING/PROPOSED/CONFIRMED — REJECTED/SUPERSEDED
   * versions are history, never current, so they can't reach here via
   * `currentDeliverySchedule`). For an item with no schedule at all, one
   * synthesized row from the order's own `expectedDeliveryDate` — skipped
   * entirely if that's also unset, or if nothing is actually outstanding
   * anymore (qtyOrdered - qtyReceived <= 0). Deliberately does NOT attempt
   * to mark any individual line as "already shipped" — `qtyReceived` is a
   * single aggregate per item, not attributable to one specific schedule
   * line, so guessing would fabricate a status this data can't support.
   */
  async listUpcomingDeliveries(actor: RequestSupplierPortalUser) {
    const orders = await this.getOpenOrderItems(actor);

    const rows: {
      orderId: string;
      productId: string | null;
      article: string;
      productName: string;
      date: Date;
      qty: unknown;
      scheduleStatus: string | null;
    }[] = [];

    for (const order of orders) {
      for (const item of order.items) {
        if (item.currentDeliverySchedule) {
          for (const line of item.currentDeliverySchedule.lines) {
            rows.push({
              orderId: order.id,
              productId: item.productId,
              article: item.articleSnapshot,
              productName: item.productNameSnapshot,
              date: line.date,
              qty: line.qty,
              scheduleStatus: item.currentDeliverySchedule.status,
            });
          }
        } else if (order.expectedDeliveryDate) {
          const remaining = Number(item.qtyOrdered) - Number(item.qtyReceived);
          if (remaining > 0) {
            rows.push({
              orderId: order.id,
              productId: item.productId,
              article: item.articleSnapshot,
              productName: item.productNameSnapshot,
              date: order.expectedDeliveryDate,
              qty: remaining,
              scheduleStatus: null,
            });
          }
        }
      }
    }

    rows.sort((a, b) => a.date.getTime() - b.date.getTime());

    const photoRows = await this.attachPhotoUrls(actor, rows);
    return { items: photoRows };
  }

  /**
   * Дашборд (2026-11-02) — a handful of small counts for the KPI cards.
   * Reuses `listUpcomingDeliveries` for the two delivery counts instead of
   * a second query — both are small in-memory filters over the same
   * already-fetched flat list.
   */
  async getDashboardSummary(actor: RequestSupplierPortalUser) {
    const [activeOrdersCount, pendingQuotesCount, catalogCount, deliveries] = await Promise.all([
      this.prisma.tenant.purchaseOrder.count({ where: { supplierId: actor.supplierId, status: { not: 'DELIVERED' } } }),
      this.prisma.tenant.purchaseRequest.count({ where: { supplierId: actor.supplierId, status: 'SENT', supplierRespondedAt: null } }),
      this.prisma.tenant.productSupplier.count({ where: { supplierId: actor.supplierId } }),
      this.listUpcomingDeliveries(actor),
    ]);

    const now = new Date();
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const overdueDeliveriesCount = deliveries.items.filter((d) => d.date < now).length;
    const upcomingDeliveriesCount = deliveries.items.filter((d) => d.date >= now && d.date <= in7Days).length;

    return { activeOrdersCount, pendingQuotesCount, catalogCount, overdueDeliveriesCount, upcomingDeliveriesCount };
  }

  /**
   * "Склад" (2026-11-02) — every open order line still outstanding
   * (qtyOrdered - qtyReceived > 0), with the supplier's own declared
   * ready-not-shipped qty alongside it.
   */
  async listStock(actor: RequestSupplierPortalUser) {
    const orders = await this.getOpenOrderItems(actor);

    const openItems = orders.flatMap((order) =>
      order.items
        .filter((item) => Number(item.qtyOrdered) - Number(item.qtyReceived) > 0)
        .map((item) => ({ order, item })),
    );

    // "розкрій має могти робити постачальник сам собі" (2026-11-02) — so the "pick
    // from my open orders" line picker on the cutting tool can pre-fill a piece's cut
    // dimensions/shape, same as the catalog picker already can. `PurchaseOrderItem.productId`
    // is a plain cross-tenant-safe scalar column, not a navigable Prisma relation (see its
    // own schema comment), so this is a separate batched lookup rather than an `include`.
    const productIds = Array.from(new Set(openItems.map(({ item }) => item.productId).filter((id): id is string => id != null)));
    const [specs, documents] = await Promise.all([
      productIds.length > 0 ? this.prisma.tenant.productCuttingSpec.findMany({ where: { productId: { in: productIds } } }) : Promise.resolve([]),
      // "воно ж розміри має витягувати для розкрою з файлів глб" (2026-11-03) — a product's own 3D
      // model (PRODUCT_DOCUMENT domain, same as listCatalog's own file-fetching) lets the cutting
      // tool fall back to a GLB bounding-box measurement when no cuttingSpec was ever configured.
      productIds.length > 0 ? this.filesService.listForEntities(this.asFilesActor(actor), 'Product', productIds, ['PRODUCT_DOCUMENT']) : Promise.resolve({}),
    ]);
    const specByProduct = new Map(specs.map((s) => [s.productId, s]));

    const items = openItems.map(({ order, item }) => {
      const spec = item.productId ? specByProduct.get(item.productId) : undefined;
      return {
        itemId: item.id,
        orderId: order.id,
        productId: item.productId,
        article: item.articleSnapshot,
        productName: item.productNameSnapshot,
        orderDate: order.orderDate,
        qtyOrdered: item.qtyOrdered,
        qtyReceived: item.qtyReceived,
        qtyRemaining: Number(item.qtyOrdered) - Number(item.qtyReceived),
        supplierReadyQty: item.supplierReadyQty,
        cuttingSpec: spec
          ? {
              kind: spec.kind,
              stockLengthCm: spec.stockLengthCm,
              stockWidthCm: spec.stockWidthCm,
              defaultCutLengthCm: spec.defaultCutLengthCm,
              defaultCutWidthCm: spec.defaultCutWidthCm,
              defaultCutShapePolygon: spec.defaultCutShapePolygon,
            }
          : null,
        files: item.productId ? (documents as any)[item.productId] ?? [] : [],
      };
    });

    const photoItems = await this.attachPhotoUrls(actor, items);
    return { items: photoItems };
  }

  /** Supplier declares how much of this line is already finished and sitting at their own premises — capped at what's actually still outstanding, never more. */
  async updateSupplierReadyQty(actor: RequestSupplierPortalUser, itemId: string, dto: UpdateSupplierReadyQtyDto) {
    const item = await this.prisma.tenant.purchaseOrderItem.findFirst({
      where: { id: itemId, purchaseOrder: { supplierId: actor.supplierId } },
    });
    if (!item) throw new CodedNotFoundException('PURCHASE_ORDER_ITEM_NOT_FOUND', 'Purchase order item not found.');

    const remaining = Number(item.qtyOrdered) - Number(item.qtyReceived);
    if (dto.supplierReadyQty > remaining) {
      throw new CodedBadRequestException('SUPPLIER_READY_QTY_EXCEEDS_REMAINING', `Cannot declare more ready (${dto.supplierReadyQty}) than is still outstanding (${remaining}).`);
    }

    const updated = await this.prisma.tenant.purchaseOrderItem.update({
      where: { id: itemId },
      data: { supplierReadyQty: dto.supplierReadyQty },
    });

    await this.auditService.record({
      companyId: actor.companyId,
      actorUserId: null,
      action: 'purchase_order_item.supplier_ready_qty_updated',
      entityType: 'PurchaseOrderItem',
      entityId: itemId,
      after: { supplierReadyQty: dto.supplierReadyQty },
      metadata: { supplierPortalUserId: actor.supplierPortalUserId, supplierId: actor.supplierId },
    });

    return updated;
  }
}
