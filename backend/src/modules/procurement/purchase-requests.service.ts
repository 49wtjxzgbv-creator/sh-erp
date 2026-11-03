import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CodedBadRequestException, CodedConflictException, CodedNotFoundException } from '../../common/api-exceptions';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FilesService } from '../files/files.service';
import { EmailService } from '../notifications/email.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { SupplierCatalogService } from './supplier-catalog.service';
import { PurchaseRequestPdfService } from './purchase-request-pdf.service';
import { PurchaseRequestRendererService } from './purchase-request-renderer.service';
import {
  CreatePurchaseRequestDto,
  QueryPurchaseRequestsDto,
  SavePurchaseRequestItemsDto,
  UpdatePurchaseRequestDto,
} from './dto/purchase-request.dto';

/**
 * Заявка на прорахунок постачальнику (2026-10-21) — a non-committal,
 * single-supplier quote request. Deliberately NOT a status on PurchaseOrder
 * itself: finance.service.ts and dashboard-timeline.service.ts both read
 * every PurchaseOrder row with no status filter, so a draft/RFQ row sharing
 * that table would silently leak into spend totals and the delivery
 * timeline. Internal-only for now — no supplier-portal exposure; staff
 * generate a PDF (generatePdf, 2026-10-21) to hand/email the supplier
 * themselves, negotiate manually, and record prices back onto the request,
 * then convert it into a real PurchaseOrder once ready.
 */
@Injectable()
export class PurchaseRequestsService {
  private readonly logger = new Logger(PurchaseRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly purchaseOrdersService: PurchaseOrdersService,
    private readonly pdfRenderer: PurchaseRequestRendererService,
    private readonly pdfService: PurchaseRequestPdfService,
    private readonly filesService: FilesService,
    private readonly emailService: EmailService,
    private readonly supplierCatalogService: SupplierCatalogService,
  ) {}

  /**
   * Same atomic per-company counter mechanism as Quotation.number
   * (DocumentNumberingService's "INSERT ... ON CONFLICT" pattern) —
   * inlined here rather than importing QuotationsModule, which would
   * create a cycle (ProcurementModule -> QuotationsModule -> SalesModule
   * -> ProcurementModule, since SalesModule already imports ProcurementModule).
   */
  private async nextNumber(user: RequestUser): Promise<string> {
    const year = new Date().getFullYear();
    const rows = await this.prisma.tenant.$queryRaw<Array<{ lastValue: number }>>(
      Prisma.sql`
        INSERT INTO company_document_counters ("companyId", "counterKey", "lastValue", "updatedAt")
        VALUES (${user.companyId}::uuid, ${`PURCHASE_REQUEST_${year}`}, 1, now())
        ON CONFLICT ("companyId", "counterKey")
        DO UPDATE SET "lastValue" = company_document_counters."lastValue" + 1, "updatedAt" = now()
        RETURNING "lastValue"
      `,
    );
    return `ЗП-${year}-${String(Number(rows[0].lastValue)).padStart(4, '0')}`;
  }

  async create(user: RequestUser, dto: CreatePurchaseRequestDto) {
    const number = await this.nextNumber(user);
    const request = await this.prisma.tenant.purchaseRequest.create({
      data: {
        number,
        supplierId: dto.supplierId,
        supplierNameSnapshot: dto.supplierNameSnapshot,
        comment: dto.comment,
        fromName: dto.fromName,
        status: 'DRAFT',
        createdById: user.userId,
      } as any,
    });

    const items = await this.createItems(user, request.id, dto.items);
    const full = { ...request, items };

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'purchase_request.created',
      entityType: 'PurchaseRequest',
      entityId: request.id,
      after: full,
    });
    return full;
  }

  /**
   * One-by-one rather than a nested/bulk create (2026-11-03) — each line
   * needs its own freshly-minted id *before* `claimRequirements` can stamp
   * it onto the requirements it aggregates, and `PurchaseRequestItem` has
   * no sortable column (no `createdAt`) to safely re-match a bulk result
   * back to `dto.items` by position afterward. Item volume per request is
   * small (a handful of lines), so N round trips is not a real cost here.
   */
  private async createItems(user: RequestUser, purchaseRequestId: string, items: CreatePurchaseRequestDto['items']) {
    const created = [];
    for (const item of items) {
      const row = await this.prisma.tenant.purchaseRequestItem.create({
        data: {
          companyId: user.companyId,
          purchaseRequestId,
          productId: item.productId,
          articleSnapshot: item.articleSnapshot,
          productNameSnapshot: item.productNameSnapshot,
          qty: item.qty,
          expectedPrice: item.expectedPrice,
          attachedFileIds: item.attachedFileIds ?? [],
        } as any,
      });
      await this.claimRequirements(user, row.id, item.requirementIds);
      created.push(row);
    }
    return created;
  }

  /**
   * Stamps `fulfillingPurchaseRequestItemId` on each selected
   * OrderMaterialRequirement so the aggregation this ЗП line represents is
   * structurally traceable (2026-11-03 — "це має підтягуватись з продажі і
   * заявки постачальникам") instead of the free-text comment staff used to
   * type by hand. `qty` itself stays whatever the caller submitted — the
   * shortage picker suggests the sum, but staff can still edit it
   * afterward, same as any other line.
   */
  private async claimRequirements(user: RequestUser, purchaseRequestItemId: string, requirementIds: string[] | undefined): Promise<void> {
    if (!requirementIds || requirementIds.length === 0) return;

    const requirements = await this.prisma.tenant.orderMaterialRequirement.findMany({ where: { id: { in: requirementIds } } });
    if (requirements.length !== requirementIds.length) {
      throw new CodedBadRequestException('PURCHASE_REQUEST_REQUIREMENT_NOT_FOUND', 'One or more selected requirements could not be found.');
    }

    const claimedElsewhereIds = requirements
      .filter((r) => r.fulfillingPurchaseRequestItemId && r.fulfillingPurchaseRequestItemId !== purchaseRequestItemId)
      .map((r) => r.fulfillingPurchaseRequestItemId!);
    if (claimedElsewhereIds.length > 0) {
      const claimants = await this.prisma.tenant.purchaseRequestItem.findMany({
        where: { id: { in: claimedElsewhereIds } },
        include: { purchaseRequest: true },
      });
      // A CANCELLED claimant's requirement stays stamped (cancel() doesn't
      // touch item rows) — only a hard delete of the item frees it via the
      // SetNull cascade — so a live request must re-check status here
      // rather than trust an unclaimed-looking id blindly.
      const liveClaimant = claimants.find((c) => c.purchaseRequest.status !== 'CANCELLED');
      if (liveClaimant) {
        throw new CodedConflictException(
          'PURCHASE_REQUEST_REQUIREMENT_ALREADY_CLAIMED',
          `This requirement is already part of purchase request ${liveClaimant.purchaseRequest.number}.`,
        );
      }
    }

    await this.prisma.tenant.orderMaterialRequirement.updateMany({
      where: { id: { in: requirementIds } },
      data: { fulfillingPurchaseRequestItemId: purchaseRequestItemId },
    });
  }

  async findOne(user: RequestUser, id: string) {
    const request = await this.prisma.tenant.purchaseRequest.findUnique({
      where: { id },
      // `fulfilledRequirements` select-only-id (2026-11-03) — lets the
      // detail page's item editor carry a line's requirementIds forward
      // across a saveItems() bulk-replace, instead of silently losing the
      // aggregation claim the way an unlisted field like
      // supplierQuotedPrice already does today.
      include: { items: { include: { fulfilledRequirements: { select: { id: true } } } } },
    });
    if (!request) throw new CodedNotFoundException('PURCHASE_REQUEST_NOT_FOUND', 'Purchase request not found.');
    return request;
  }

  async query(user: RequestUser, query: QueryPurchaseRequestsDto) {
    const where: Prisma.PurchaseRequestWhereInput = {};
    if (query.status) where.status = query.status as any;
    if (query.supplierId) where.supplierId = query.supplierId;

    const take = query.limit ?? 50;
    const skip = query.offset ?? 0;
    const [items, total] = await Promise.all([
      this.prisma.tenant.purchaseRequest.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip }),
      this.prisma.tenant.purchaseRequest.count({ where }),
    ]);
    return { items, total, limit: take, offset: skip };
  }

  private assertEditable(request: { status: string }) {
    if (request.status === 'CONVERTED' || request.status === 'CANCELLED') {
      throw new CodedBadRequestException('PURCHASE_REQUEST_CANNOT_EDIT_TERMINAL', `Cannot change a ${request.status} purchase request.`);
    }
  }

  async update(user: RequestUser, id: string, dto: UpdatePurchaseRequestDto) {
    const before = await this.findOne(user, id);
    this.assertEditable(before);
    let request;
    try {
      request = await this.prisma.tenant.purchaseRequest.update({ where: { id }, data: dto as any });
    } catch (err) {
      // number is editable (2026-10-21 user request — staff may want to append a suffix or
      // match an external numbering scheme) but stays unique per company (@@unique([companyId, number])).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new CodedConflictException('PURCHASE_REQUEST_NUMBER_ALREADY_EXISTS', `A purchase request with number "${dto.number}" already exists.`);
      }
      throw err;
    }
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'purchase_request.updated',
      entityType: 'PurchaseRequest',
      entityId: id,
      before,
      after: request,
    });
    return request;
  }

  /**
   * Full bulk replace — same convention as QuotationsService#saveItems:
   * simplest correct approach for a brand-new entity with no
   * existing-immutability constraint to work around. Deleting the old
   * items first frees any requirements they had claimed back up
   * automatically, via `fulfillingPurchaseRequestItemId`'s `onDelete:
   * SetNull` — no separate unclaim step needed.
   */
  async saveItems(user: RequestUser, id: string, dto: SavePurchaseRequestItemsDto) {
    const before = await this.findOne(user, id);
    this.assertEditable(before);

    await this.prisma.tenant.purchaseRequestItem.deleteMany({ where: { purchaseRequestId: id } });
    await this.createItems(user, id, dto.items);

    const after = await this.findOne(user, id);
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'purchase_request.items_saved',
      entityType: 'PurchaseRequest',
      entityId: id,
      before,
      after,
    });
    return after;
  }

  /** DRAFT -> SENT marker only (no PDF/email to staff) — editing stays allowed afterward, unlike Quotation's hard lock, since this is an internal tracker staff keep updating as the supplier calls back with prices. Still a real "I'm sending this to the supplier" moment though, so it's the hook point for the (best-effort) supplier-portal notification below. */
  async send(user: RequestUser, id: string) {
    const before = await this.findOne(user, id);
    this.assertEditable(before);
    const request = await this.prisma.tenant.purchaseRequest.update({ where: { id }, data: { status: 'SENT', sentAt: new Date() } });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'purchase_request.sent',
      entityType: 'PurchaseRequest',
      entityId: id,
      before,
      after: request,
    });

    await this.notifySupplierPortalIfConnected(user, request);
    await this.populateSupplierCatalog(user, request);
    return request;
  }

  /**
   * "якщо ми йому відправляємо товари на прорахунок... автоматично мають
   * підтягуватись в каталог" (2026-11-02) — same SENT-only moment as the
   * notification above. `ensureCatalogEntries` is itself best-effort and
   * never throws, but the `findMany` here isn't, so this whole step is
   * wrapped too — must never block send() itself.
   */
  private async populateSupplierCatalog(user: RequestUser, request: { id: string; supplierId: string | null }): Promise<void> {
    try {
      const items = await this.prisma.tenant.purchaseRequestItem.findMany({ where: { purchaseRequestId: request.id } });
      await this.supplierCatalogService.ensureCatalogEntries(
        user,
        request.supplierId,
        items.map((i) => i.productId),
      );
    } catch (err) {
      this.logger.warn(`Failed to populate supplier catalog (request=${request.id}): ${err}`);
    }
  }

  /**
   * "коли я роблю заявку на прорахунок постачальнику також має надсилатись
   * у акаунт постачальника якщо він підключений" (2026-11-02): best-effort
   * (never fails send() itself, same swallow-and-log shape as
   * SupplierPortalService#notifyStaff) — the request becomes visible in
   * the portal purely via SupplierPortalService#listPurchaseRequests'
   * own `where: {supplierId, status: {not: 'DRAFT'}}` query the moment
   * status flips to SENT above; this email is just a heads-up so the
   * supplier doesn't have to think to go check. Silently does nothing for
   * a free-text-only supplier (no `supplierId`, hence no `Supplier` row to
   * look a connection up for) or one with no ACTIVE connection.
   */
  private async notifySupplierPortalIfConnected(
    user: RequestUser,
    request: { id: string; number: string; supplierId: string | null },
  ): Promise<void> {
    if (!request.supplierId) return;
    try {
      const connection = await this.prisma.tenant.supplierConnection.findUnique({
        where: { supplierId: request.supplierId },
        include: { supplierOrganization: { include: { portalUser: true } } },
      });
      const portalUser = connection?.supplierOrganization.portalUser;
      if (connection?.status !== 'ACTIVE' || !portalUser?.active) return;

      const company = await this.prisma.tenant.company.findUnique({ where: { id: user.companyId } });
      await this.emailService.send(
        portalUser.email,
        'Нова заявка на прорахунок — SH ERP',
        `Компанія «${company?.name ?? ''}» надіслала вам заявку на прорахунок ${request.number}. Увійдіть у портал постачальника, щоб переглянути позиції та внести ціни.`,
      );
    } catch (err) {
      this.logger.warn(`Failed to send supplier-portal new-request notification (request=${request.id}): ${err}`);
    }
  }

  async cancel(user: RequestUser, id: string) {
    const before = await this.findOne(user, id);
    this.assertEditable(before);
    const request = await this.prisma.tenant.purchaseRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'purchase_request.cancelled',
      entityType: 'PurchaseRequest',
      entityId: id,
      before,
      after: request,
    });
    return request;
  }

  /**
   * Creates one or more real PurchaseOrders from the request's current
   * items via PurchaseOrdersService — the exact same create() path a staff
   * member creating a PO directly would hit, so each new order gets the
   * normal ORDERED status and is indistinguishable from any other
   * PurchaseOrder. Presence of convertedPurchaseOrderId alone blocks
   * re-conversion (mirrors Quotation.convertedCustomerOrderId's own
   * convention).
   *
   * Fans out (2026-11-03 — "це має підтягуватись з продажі і заявки
   * постачальникам"): a line built from the shortage picker aggregates
   * requirements from several CustomerOrders, but PurchaseOrder/
   * PurchaseOrderItem must stay exactly one order per item — receive-time
   * stock allocation (StockReservationService#topUp), Finance's cost
   * rollup, and the planner board all key off that single-order shape
   * (`PurchaseOrder.sourceCustomerOrderId`/`PurchaseOrderItem.
   * sourceRequirementId`). So each aggregated line gets split back into
   * one PurchaseOrder per distinct customer order it draws from — same
   * shape CustomerOrderShortageService#createPurchaseOrdersFromGroups
   * already produces for the single-order case — with every resulting
   * item stamped `originatingPurchaseRequestItemId` so the delivery-
   * schedule "fill once for the group" flow can find its siblings. Lines
   * with no linked requirements (the ordinary, pre-existing case) still
   * go through exactly one plain PurchaseOrder, unchanged.
   */
  async convertToOrder(user: RequestUser, id: string) {
    const request = await this.findOne(user, id);
    if (request.status === 'CONVERTED' || request.status === 'CANCELLED') {
      throw new CodedConflictException('PURCHASE_REQUEST_ALREADY_CONVERTED', `Cannot convert a ${request.status} purchase request.`);
    }

    const items = request.items as any[];
    const requirements = await this.prisma.tenant.orderMaterialRequirement.findMany({
      where: { fulfillingPurchaseRequestItemId: { in: items.map((i) => i.id) } },
      include: { customerOrder: true },
    });
    const requirementsByItemId = new Map<string, typeof requirements>();
    for (const req of requirements) {
      const list = requirementsByItemId.get(req.fulfillingPurchaseRequestItemId!) ?? [];
      list.push(req);
      requirementsByItemId.set(req.fulfillingPurchaseRequestItemId!, list);
    }

    // Supplier quote wins over staff's own typed-in price (2026-11-02) —
    // otherwise a submitted quote would sit inert and staff would have to
    // manually retype it here before converting.
    const resolvePrice = (item: any): number | undefined =>
      item.supplierQuotedPrice != null ? Number(item.supplierQuotedPrice) : item.expectedPrice != null ? Number(item.expectedPrice) : undefined;

    const unlinkedItems: any[] = [];
    const itemsByCustomerOrderId = new Map<string, any[]>();

    for (const item of items) {
      const itemRequirements = requirementsByItemId.get(item.id);
      if (!itemRequirements || itemRequirements.length === 0) {
        unlinkedItems.push({
          productId: item.productId ?? undefined,
          articleSnapshot: item.articleSnapshot,
          productNameSnapshot: item.productNameSnapshot,
          qtyOrdered: Number(item.qty),
          expectedPrice: resolvePrice(item),
        });
        continue;
      }

      const requirementsByOrderId = new Map<string, typeof itemRequirements>();
      for (const req of itemRequirements) {
        const list = requirementsByOrderId.get(req.customerOrderId) ?? [];
        list.push(req);
        requirementsByOrderId.set(req.customerOrderId, list);
      }

      // Proportional split of this line's (possibly staff-edited) qty by
      // each order's share of requiredQty — the exact unit-for-unit amount
      // isn't safety-critical here, since StockReservationService#topUp
      // caps real allocation to each order's live outstanding need again
      // at receive time regardless of how qtyOrdered was split up front.
      // Remainder goes to the order with the earliest deadline, same
      // rounding convention the delivery-schedule bulk-split uses.
      const orderEntries = Array.from(requirementsByOrderId.entries()).sort((a, b) => {
        const deadlineA = a[1][0].customerOrder.deadline ? new Date(a[1][0].customerOrder.deadline).getTime() : -Infinity;
        const deadlineB = b[1][0].customerOrder.deadline ? new Date(b[1][0].customerOrder.deadline).getTime() : -Infinity;
        return deadlineB - deadlineA;
      });
      const totalWeight = itemRequirements.reduce((sum, r) => sum + Number(r.requiredQty), 0);
      const totalQty = Number(item.qty);
      const price = resolvePrice(item);

      let allocatedQty = 0;
      orderEntries.forEach(([customerOrderId, orderRequirements], index) => {
        const isLast = index === orderEntries.length - 1;
        const weight = orderRequirements.reduce((sum, r) => sum + Number(r.requiredQty), 0);
        const qtyOrdered = isLast ? totalQty - allocatedQty : Math.round((weight / totalWeight) * totalQty * 1000) / 1000;
        allocatedQty += qtyOrdered;
        if (qtyOrdered <= 0) return;

        const list = itemsByCustomerOrderId.get(customerOrderId) ?? [];
        list.push({
          productId: item.productId ?? undefined,
          articleSnapshot: item.articleSnapshot,
          productNameSnapshot: item.productNameSnapshot,
          qtyOrdered,
          expectedPrice: price,
          sourceRequirementId: orderRequirements[0].id,
          originatingPurchaseRequestItemId: item.id,
        });
        itemsByCustomerOrderId.set(customerOrderId, list);
      });
    }

    const orders = [];
    if (unlinkedItems.length > 0) {
      orders.push(
        await this.purchaseOrdersService.create(user, {
          supplierId: request.supplierId ?? undefined,
          supplierNameSnapshot: request.supplierNameSnapshot,
          comment: request.comment ?? undefined,
          items: unlinkedItems,
        }),
      );
    }
    for (const [customerOrderId, orderItems] of itemsByCustomerOrderId) {
      orders.push(
        await this.purchaseOrdersService.create(user, {
          supplierId: request.supplierId ?? undefined,
          supplierNameSnapshot: request.supplierNameSnapshot,
          comment: request.comment ?? undefined,
          sourceCustomerOrderId: customerOrderId,
          items: orderItems,
        }),
      );
    }

    const updated = await this.prisma.tenant.purchaseRequest.update({
      where: { id },
      data: { status: 'CONVERTED', convertedPurchaseOrderId: orders[0].id },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'purchase_request.converted',
      entityType: 'PurchaseRequest',
      entityId: id,
      before: request,
      after: updated,
    });

    // `purchaseOrder` kept for existing callers that navigate to a single
    // created order; `purchaseOrders` carries the full fan-out for the
    // (normal) multi-order case.
    return { purchaseOrder: orders[0], purchaseOrders: orders, purchaseRequest: updated };
  }

  /**
   * "кидати цю заявку постачальнику" (2026-10-21) — renders the current
   * state (items/prices/comment, whatever is filled in right now) to a
   * real PDF and stores it, overwriting any previous pdfFileId. Allowed in
   * any non-deleted status (including DRAFT, unlike Quotation's send()
   * which requires a committed SENT transition first) — this is a
   * standalone document action, independent of the status marker set()
   * flips; staff may regenerate it as many times as prices change.
   */
  async generatePdf(user: RequestUser, id: string) {
    const request = await this.findOne(user, id);
    const items = request.items as any[];

    const productIds = [...new Set(items.map((i) => i.productId).filter((v): v is string => Boolean(v)))];

    const [branding, productPhotos] = await Promise.all([
      this.prisma.tenant.companyBranding.findUnique({ where: { companyId: user.companyId } }),
      productIds.length > 0 ? this.filesService.listForEntities(user, 'Product', productIds, ['PRODUCT_PHOTO']) : {},
    ]);

    // Settings → Branding → "Логотип друку" (CompanyBranding.printLogoFileId) — same fallback-to-nothing shape as Quotation's own logoUrl resolution (QuotationsService#renderVersionHtml).
    const fromLogoUrl = branding?.printLogoFileId
      ? ((await this.filesService.getDownloadUrl(user, branding.printLogoFileId).catch(() => null))?.downloadUrl ?? null)
      : null;

    const attachments = items.flatMap((item) => ((item.attachedFileIds as string[]) ?? []).map((fileAssetId) => ({ fileAssetId })));

    const html = this.pdfRenderer.renderHtml({
      number: request.number,
      createdAt: request.createdAt,
      // No default to the company's own name (2026-10-21 user request) — blank unless staff explicitly types an override.
      fromName: request.fromName || '',
      fromLogoUrl,
      supplier: { name: request.supplierNameSnapshot },
      comment: request.comment,
      items: items.map((item) => ({
        articleSnapshot: item.articleSnapshot,
        productNameSnapshot: item.productNameSnapshot,
        qty: Number(item.qty),
        photoUrl: item.productId ? ((productPhotos as any)[item.productId]?.[0]?.downloadUrl ?? null) : null,
      })),
    });

    const pdfFileId = await this.pdfService.generateAndStore(user, {
      purchaseRequestId: id,
      purchaseRequestNumber: request.number,
      html,
      attachments,
    });

    const updated = await this.prisma.tenant.purchaseRequest.update({ where: { id }, data: { pdfFileId }, include: { items: true } });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'purchase_request.pdf_generated',
      entityType: 'PurchaseRequest',
      entityId: id,
      after: { pdfFileId },
    });

    return updated;
  }

  /** DRAFT only — a sent/converted/cancelled request stays as a record (use cancel() for the reversible version of "not proceeding"). */
  async remove(user: RequestUser, id: string) {
    const request = await this.findOne(user, id);
    if (request.status !== 'DRAFT') {
      throw new CodedBadRequestException('PURCHASE_REQUEST_CANNOT_DELETE_NON_DRAFT', 'Only a DRAFT purchase request can be deleted — cancel it instead.');
    }
    await this.prisma.tenant.purchaseRequest.delete({ where: { id } });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'purchase_request.deleted',
      entityType: 'PurchaseRequest',
      entityId: id,
      before: request,
    });
  }
}
