import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CodedBadRequestException, CodedConflictException, CodedNotFoundException } from '../../common/api-exceptions';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AssembliesService } from '../bom/assemblies.service';
import { CustomerOrdersService } from '../sales/customer-orders.service';
import { FilesService } from '../files/files.service';
import { DocumentNumberingService } from './document-numbering.service';
import { QuotationPricingService } from './quotation-pricing.service';
import { QuotationPdfService } from './quotation-pdf.service';
import { QuotationRendererService } from './quotation-renderer.service';
import { CreateQuotationDto, QueryQuotationsDto, QuotationItemInputDto, SaveQuotationItemsDto, UpdateQuotationVersionDto } from './dto/quotation.dto';

/**
 * КП ≠ CustomerOrder (explicit user decision) — a Quotation exists
 * independently, never auto-creates an order, and only ever becomes one
 * through convertToOrder(), always from an ACCEPTED version's frozen
 * snapshot.
 *
 * Versioning follows AssemblyVersion's own "freeze a whole tree, never
 * update it again" philosophy: while the CURRENT version (highest
 * versionNumber for this quotation) has no `sentAt`, it IS the live DRAFT
 * and updateVersionTerms/saveItems freely rewrite it in place — no new
 * version row per edit, that would be version-number spam for ordinary
 * drafting. The moment send() sets sentAt, every write path in this
 * service refuses to touch that version again (assertEditable) — the ONLY
 * way to change anything after that is createNewVersion(), which appends
 * a fresh, once-again-editable version and drops Quotation.status back to
 * DRAFT.
 */
@Injectable()
export class QuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly numberingService: DocumentNumberingService,
    private readonly pricingService: QuotationPricingService,
    private readonly assembliesService: AssembliesService,
    private readonly pdfService: QuotationPdfService,
    private readonly customerOrdersService: CustomerOrdersService,
    private readonly rendererService: QuotationRendererService,
    private readonly filesService: FilesService,
  ) {}

  async create(user: RequestUser, dto: CreateQuotationDto) {
    const customer = await this.prisma.tenant.customer.findUnique({ where: { id: dto.customerId } });
    if (!customer) throw new CodedNotFoundException('QUOTATION_CUSTOMER_NOT_FOUND', 'Customer not found.');
    if (dto.templateId) {
      const template = await this.prisma.tenant.quotationTemplate.findUnique({ where: { id: dto.templateId } });
      if (!template) throw new CodedNotFoundException('QUOTATION_TEMPLATE_NOT_FOUND', 'Quotation template not found.');
    }

    const number = await this.numberingService.nextQuotationNumber(user);
    const quotation = await this.prisma.tenant.quotation.create({
      data: { number, customerId: dto.customerId, status: 'DRAFT', createdById: user.userId } as any,
    });
    await this.prisma.tenant.quotationVersion.create({
      data: {
        quotationId: quotation.id,
        versionNumber: 1,
        validUntil: dto.validUntil,
        currency: dto.currency ?? 'EUR',
        paymentTerms: dto.paymentTerms,
        deliveryTerms: dto.deliveryTerms,
        installationTerms: dto.installationTerms,
        notes: dto.notes,
        templateId: dto.templateId,
        subtotal: 0,
        discountAmount: 0,
        total: 0,
        createdById: user.userId,
      } as any,
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'quotation.created',
      entityType: 'Quotation',
      entityId: quotation.id,
      after: { number, customerId: dto.customerId },
    });

    return this.findOne(user, quotation.id);
  }

  async findOne(user: RequestUser, id: string) {
    const quotation = await this.prisma.tenant.quotation.findUnique({
      where: { id },
      include: {
        customer: true,
        versions: { orderBy: { versionNumber: 'desc' }, include: { items: { orderBy: { sortOrder: 'asc' } } } },
      },
    });
    if (!quotation) throw new CodedNotFoundException('QUOTATION_NOT_FOUND', 'Quotation not found.');
    const [currentVersion, ...history] = (quotation as any).versions;

    // §16/§19 of the final confirmation: cost/base-price/margin are
    // internal-only. unitPrice/subtotal/discount/total stay — those ARE the
    // client-facing quote price, already visible to any quotations:read
    // holder. Only the figures that reveal the company's cost basis are
    // gated behind quotations:view-margin.
    if (!(await this.userHasPermission(user, 'quotations:view-margin'))) {
      const strip = (v: any) => ({ ...v, items: v.items.map((i: any) => ({ ...i, costSnapshot: null, basePriceSnapshot: null, pricingPercent: null })) });
      return {
        ...quotation,
        currentVersion: currentVersion ? strip(currentVersion) : currentVersion,
        versionHistory: history.map(strip),
      };
    }

    return { ...quotation, currentVersion, versionHistory: history };
  }

  /** Same role→permission lookup TenantScopeInterceptor uses for route-level gating (tenant-scope.interceptor.ts), reused here for an in-handler, optional-permission check — there's no reusable AuthorizationService method for this yet elsewhere in the codebase. */
  private async userHasPermission(user: RequestUser, key: string): Promise<boolean> {
    const role = await this.prisma.tenant.role.findUnique({ where: { id: user.roleId }, include: { permissions: { include: { permission: true } } } });
    if (!role) return false;
    return role.permissions.some((rp: any) => rp.permission.key === key);
  }

  /** Soft delete — same shape as QuotationTemplatesService#remove/CustomersService#remove. No status/conversion guard: a duplicated/converted quotation keeps existing as the ORIGINAL row those relations point at (duplicatedFromId, CustomerOrder.sourceQuotation) — only `deletedAt` changes, so nothing referencing it breaks. */
  async remove(user: RequestUser, id: string) {
    const before = await this.findOne(user, id);
    if (before.deletedAt) throw new CodedConflictException('QUOTATION_ALREADY_DELETED', 'Quotation is already deleted.');
    const quotation = await this.prisma.tenant.quotation.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'quotation.deleted',
      entityType: 'Quotation',
      entityId: id,
      before,
    });
    return quotation;
  }

  async query(user: RequestUser, query: QueryQuotationsDto) {
    const where: Prisma.QuotationWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status as any;
    if (query.customerId) where.customerId = query.customerId;
    if (query.search) {
      where.OR = [{ number: { contains: query.search, mode: 'insensitive' } }, { customer: { name: { contains: query.search, mode: 'insensitive' } } }];
    }

    const take = query.limit ?? 50;
    const skip = query.offset ?? 0;
    const [rows, total] = await Promise.all([
      this.prisma.tenant.quotation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        include: { customer: true, versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
      }),
      this.prisma.tenant.quotation.count({ where }),
    ]);

    const items = rows.map((q: any) => {
      const [currentVersion] = q.versions;
      return {
        id: q.id,
        number: q.number,
        status: q.status,
        customerId: q.customerId,
        customerName: q.customer.name,
        createdById: q.createdById,
        createdAt: q.createdAt,
        // Explicit Number(...) — currentVersion.total is a Prisma Decimal,
        // which serializes over JSON as a STRING (see frontend's
        // lib/api-client/decimal.ts header comment for the full contract).
        // Every other list-row money/computed field in this codebase that
        // isn't a raw passthrough Decimal (e.g. CustomerOrder.estimatedTotal)
        // is a real JSON number for exactly this reason — matches that
        // convention instead of silently leaking a Decimal string here.
        total: currentVersion ? Number(currentVersion.total) : 0,
        currency: currentVersion?.currency ?? 'EUR',
        validUntil: currentVersion?.validUntil ?? null,
        isExpired: this.isExpired(q.status, currentVersion?.validUntil ?? null),
      };
    });

    return { items, total, limit: take, offset: skip };
  }

  private isExpired(status: string, validUntil: Date | null): boolean {
    // Computed, never persisted (§18 of the request; see QuotationStatus's
    // own schema.prisma comment for the full reasoning) — only meaningful
    // for a quotation that's out with the client and hasn't been decided.
    return (status === 'SENT' || status === 'VIEWED') && validUntil !== null && validUntil.getTime() < Date.now();
  }

  private async getCurrentVersion(quotationId: string) {
    const version = await this.prisma.tenant.quotationVersion.findFirst({ where: { quotationId }, orderBy: { versionNumber: 'desc' } });
    if (!version) throw new CodedNotFoundException('QUOTATION_NOT_FOUND', 'Quotation not found.');
    return version;
  }

  private assertVersionEditable(version: { sentAt: Date | null }) {
    if (version.sentAt) {
      throw new CodedConflictException('QUOTATION_VERSION_LOCKED', 'This version was already sent and is now immutable — use "Створити нову версію" to make changes.');
    }
  }

  async updateVersionTerms(user: RequestUser, quotationId: string, dto: UpdateQuotationVersionDto) {
    const version = await this.getCurrentVersion(quotationId);
    this.assertVersionEditable(version);
    const updated = await this.prisma.tenant.quotationVersion.update({
      where: { id: version.id },
      data: {
        validUntil: dto.validUntil,
        currency: dto.currency,
        paymentTerms: dto.paymentTerms,
        deliveryTerms: dto.deliveryTerms,
        installationTerms: dto.installationTerms,
        notes: dto.notes,
        templateId: dto.templateId,
      } as any,
    });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'quotation.updated',
      entityType: 'Quotation',
      entityId: quotationId,
      after: dto,
    });
    return updated;
  }

  /**
   * Full replacement of the current version's item list — simpler and
   * safer than a per-line PATCH API for a "live-recalculating editor"
   * UI that already holds the whole list client-side and saves it as a
   * unit (same shape as AssembliesService#setComponents' own
   * full-replace convention for BOM lines). Every reference field
   * (assemblyId/productId) is resolved live HERE, at save time — this is
   * the ONLY place in the whole Quotations module that ever reads
   * Assembly.baseSalePriceEur, calculates cost, or copies a name/
   * description off a live row, precisely because this is the one moment
   * where "live" is still correct: the version isn't sent yet.
   */
  async saveItems(user: RequestUser, quotationId: string, dto: SaveQuotationItemsDto) {
    const version = await this.getCurrentVersion(quotationId);
    this.assertVersionEditable(version);

    const resolved = [];
    for (let index = 0; index < dto.items.length; index++) {
      resolved.push(await this.resolveItem(user, dto.items[index], index, version.currency));
    }

    await this.prisma.tenant.quotationVersionItem.deleteMany({ where: { quotationVersionId: version.id } });
    for (const item of resolved) {
      await this.prisma.tenant.quotationVersionItem.create({ data: { quotationVersionId: version.id, ...item } as any });
    }

    const subtotal = round2(resolved.reduce((sum, i) => sum + i.subtotal, 0));
    const discountAmount = round2(resolved.reduce((sum, i) => sum + i.discountAmount, 0));
    const total = round2(resolved.reduce((sum, i) => sum + i.total, 0));
    await this.prisma.tenant.quotationVersion.update({ where: { id: version.id }, data: { subtotal, discountAmount, total } });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'quotation.updated',
      entityType: 'Quotation',
      entityId: quotationId,
      after: { itemCount: resolved.length, total },
    });

    return this.findOne(user, quotationId);
  }

  private async resolveItem(user: RequestUser, dto: QuotationItemInputDto, sortOrder: number, currency: string) {
    let nameSnapshot = dto.nameSnapshot;
    let cost: number | null = null;
    let basePrice: number | null = null;
    let laborCost: number | null = null;

    if (dto.kind === 'ASSEMBLY') {
      if (!dto.assemblyId) throw new CodedBadRequestException('QUOTATION_ITEM_ASSEMBLY_ID_REQUIRED', 'assemblyId is required for kind=ASSEMBLY.');
      const assembly = await this.prisma.tenant.assembly.findUnique({ where: { id: dto.assemblyId } });
      if (!assembly) throw new CodedNotFoundException('QUOTATION_ITEM_ASSEMBLY_NOT_FOUND', 'Assembly not found.');
      nameSnapshot = nameSnapshot ?? assembly.name;
      basePrice = assembly.baseSalePriceEur !== null ? Number(assembly.baseSalePriceEur) : null;
      laborCost = Number(assembly.laborCostPerUnit);
      const costResult = await this.assembliesService.calculateCost(user, dto.assemblyId);
      cost = costResult.costPerUnit;
    } else if (dto.kind === 'PRODUCT') {
      if (!dto.productId) throw new CodedBadRequestException('QUOTATION_ITEM_PRODUCT_ID_REQUIRED', 'productId is required for kind=PRODUCT.');
      const product = await this.prisma.tenant.product.findUnique({ where: { id: dto.productId } });
      if (!product) throw new CodedNotFoundException('QUOTATION_ITEM_PRODUCT_NOT_FOUND', 'Product not found.');
      nameSnapshot = nameSnapshot ?? product.name;
      cost = product.sellPriceEur !== null ? Number(product.sellPriceEur) : null;
    } else if (!nameSnapshot) {
      throw new CodedBadRequestException('QUOTATION_ITEM_NAME_REQUIRED', `nameSnapshot is required for kind=${dto.kind}.`);
    }

    const pricing = this.pricingService.computeItemPricing({
      pricingSource: dto.pricingSource as any,
      quantity: dto.quantity,
      basePrice,
      cost,
      laborCost,
      pricingPercent: dto.pricingPercent ?? null,
      customUnitPrice: dto.customUnitPrice ?? null,
      discountPercent: dto.discountPercent ?? 0,
      discountAmountOverride: dto.discountAmountOverride ?? null,
    });

    return {
      sortOrder,
      kind: dto.kind,
      assemblyId: dto.assemblyId ?? null,
      productId: dto.productId ?? null,
      nameSnapshot: nameSnapshot!,
      descriptionSnapshot: dto.descriptionSnapshot ?? null,
      quantity: dto.quantity,
      unit: dto.unit ?? 'шт',
      pricingSource: dto.pricingSource,
      costSnapshot: cost,
      basePriceSnapshot: basePrice,
      laborCostSnapshot: laborCost,
      pricingPercent: dto.pricingPercent ?? null,
      unitPrice: pricing.unitPrice,
      currency,
      discountPercent: dto.discountPercent ?? 0,
      discountAmount: pricing.discountAmount,
      subtotal: pricing.subtotal,
      total: pricing.total,
      // Never trusted from the request — see approveBelowCost's own
      // comment for why this can only ever flip true through that
      // dedicated, separately-permissioned endpoint.
      belowCostApproved: false,
      belowCostApprovedById: null,
    };
  }

  /**
   * §4: the ONLY path that can set belowCostApproved=true — deliberately
   * not a field saveItems will accept directly, so a role with plain
   * quotations:manage (bulk item editing) can't quietly wave through an
   * under-cost sale by slipping the flag into a save payload; only
   * whoever holds quotations:approve-below-cost (checked at the
   * controller) can call this specific endpoint.
   */
  async approveBelowCost(user: RequestUser, quotationId: string, itemId: string) {
    const version = await this.getCurrentVersion(quotationId);
    this.assertVersionEditable(version);
    const item = await this.prisma.tenant.quotationVersionItem.findUnique({ where: { id: itemId } });
    if (!item || item.quotationVersionId !== version.id) {
      throw new CodedNotFoundException('QUOTATION_ITEM_NOT_FOUND', 'Item not found on the current version.');
    }
    const updated = await this.prisma.tenant.quotationVersionItem.update({
      where: { id: itemId },
      data: { belowCostApproved: true, belowCostApprovedById: user.userId },
    });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'quotation.below_cost_approved',
      entityType: 'Quotation',
      entityId: quotationId,
      after: { itemId, unitPrice: updated.unitPrice, costSnapshot: updated.costSnapshot },
    });
    return updated;
  }

  /**
   * §17: fixes the version (sentAt), generates the PDF, and stores it —
   * all inside the same request. Both this method's own steps and
   * PrismaService's per-request transaction (TenantScopeInterceptor)
   * mean a PDF-generation failure rolls back sentAt along with it: SENT
   * never commits without a real, stored PDF.
   */
  async send(user: RequestUser, quotationId: string) {
    const version = await this.getCurrentVersion(quotationId);
    this.assertVersionEditable(version);

    const items = await this.prisma.tenant.quotationVersionItem.findMany({ where: { quotationVersionId: version.id }, orderBy: { sortOrder: 'asc' } });
    if (items.length === 0) {
      throw new CodedBadRequestException('QUOTATION_NO_ITEMS', 'Add at least one item before sending.');
    }
    const unapproved = items.filter((i) => {
      const cost = i.costSnapshot !== null ? Number(i.costSnapshot) : null;
      return cost !== null && Number(i.total) < round2(cost * Number(i.quantity)) && !i.belowCostApproved;
    });
    if (unapproved.length > 0) {
      throw new CodedConflictException(
        'QUOTATION_BELOW_COST_NOT_APPROVED',
        `${unapproved.length} line(s) are priced below cost and have not been approved — approve or reprice them before sending.`,
      );
    }

    const quotation = await this.prisma.tenant.quotation.findUnique({ where: { id: quotationId } });
    if (!quotation) throw new CodedNotFoundException('QUOTATION_NOT_FOUND', 'Quotation not found.');

    const { html, template, templateSnapshot, companySnapshot } = await this.renderVersionHtml(user, quotation, version, items);

    const pdfFileId = await this.pdfService.generateAndStore(user, {
      quotationId,
      quotationVersionId: version.id,
      quotationNumber: quotation.number,
      html,
    });

    await this.prisma.tenant.quotationVersion.update({
      where: { id: version.id },
      data: {
        sentAt: new Date(),
        templateId: template?.id ?? null,
        templateSnapshot: templateSnapshot as any,
        companySnapshot: companySnapshot as any,
        pdfFileId,
      },
    });
    await this.prisma.tenant.quotation.update({ where: { id: quotationId }, data: { status: 'SENT' } });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'quotation.sent',
      entityType: 'Quotation',
      entityId: quotationId,
      after: { versionId: version.id, versionNumber: version.versionNumber, pdfFileId },
    });

    return this.findOne(user, quotationId);
  }

  /**
   * §8: "Quotation data → Quotation renderer → HTML → [Preview, PDF]" —
   * the ONE place that assembles a QuotationRenderData and calls
   * QuotationRendererService, shared by send() (needs the PDF) and
   * previewHtml() (needs only the HTML, works on a still-editable DRAFT
   * version too, unlike send()). Resolving the logo to a presigned URL
   * happens here rather than in the renderer itself, since only this
   * service has FilesService access — the renderer stays a pure function.
   */
  private async renderVersionHtml(
    user: RequestUser,
    quotation: { id: string; number: string; customerId: string },
    version: {
      createdAt: Date;
      validUntil: Date | null;
      currency: string;
      subtotal: unknown;
      discountAmount: unknown;
      total: unknown;
      paymentTerms: string | null;
      deliveryTerms: string | null;
      installationTerms: string | null;
      notes: string | null;
      templateId: string | null;
    },
    items: Array<{
      kind: string;
      assemblyId: string | null;
      productId: string | null;
      nameSnapshot: string;
      descriptionSnapshot: string | null;
      quantity: unknown;
      unit: string;
      unitPrice: unknown;
      discountPercent: unknown;
      discountAmount: unknown;
      total: unknown;
    }>,
  ) {
    const customer = await this.prisma.tenant.customer.findUnique({ where: { id: quotation.customerId } });
    const template = version.templateId
      ? await this.prisma.tenant.quotationTemplate.findUnique({ where: { id: version.templateId } })
      : await this.prisma.tenant.quotationTemplate.findFirst({ where: { isDefault: true } });
    const company = await this.prisma.tenant.company.findUnique({ where: { id: user.companyId } });
    // Settings → Branding → "Логотип друку" (CompanyBranding.printLogoFileId)
    // — a QuotationTemplate can override it per-template, but most companies
    // never create a template at all, so this fallback is what actually
    // makes the branding settings page's logo show up on a real KП. Was
    // documented in this schema's own comment on printLogoFileId from day
    // one but never wired up until a real user reported the gap.
    const branding = await this.prisma.tenant.companyBranding.findUnique({ where: { companyId: user.companyId } });
    // Same fallback shape as the logo above: Settings → "Реквізити компанії"
    // is what actually fills in the PDF's company-details block for anyone
    // who hasn't hand-written a per-template override.
    const requisites = await this.prisma.tenant.companyRequisites.findUnique({ where: { companyId: user.companyId } });

    const templateSnapshot = template
      ? {
          accentColor: template.accentColor,
          printLogoFileId: template.printLogoFileId,
          headerText: template.headerText,
          footerText: template.footerText,
          visibleBlocks: template.visibleBlocks,
        }
      : null;
    const companySnapshot = {
      name: company?.name ?? '',
      companyDetailsText: template?.companyDetailsText || formatRequisitesText(requisites),
    };

    const logoFileId = template?.printLogoFileId ?? branding?.printLogoFileId ?? null;
    const logoUrl = logoFileId ? (await this.filesService.getDownloadUrl(user, logoFileId).catch(() => null))?.downloadUrl ?? null : null;

    // Article/photo are resolved LIVE (not frozen at save time like price)
    // — same "cosmetic, not financial" tier as the logo above. A later
    // rename/re-photograph shows up on an already-SENT version's re-render;
    // that's an accepted tradeoff, not a snapshot-integrity violation, since
    // nothing here affects what the client is actually being charged.
    const renderItems = await Promise.all(
      items.map(async (i) => {
        let article: string | null = null;
        let photoUrl: string | null = null;
        if (i.kind === 'ASSEMBLY' && i.assemblyId) {
          const assembly = await this.prisma.tenant.assembly.findUnique({ where: { id: i.assemblyId } });
          article = assembly?.article ?? null;
          const photos = await this.filesService.listForEntities(user, 'Assembly', [i.assemblyId], ['ASSEMBLY_PHOTO']);
          photoUrl = photos[i.assemblyId]?.[0]?.downloadUrl ?? null;
        } else if (i.kind === 'PRODUCT' && i.productId) {
          const product = await this.prisma.tenant.product.findUnique({ where: { id: i.productId } });
          article = product?.article ?? null;
          const photos = await this.filesService.listForEntities(user, 'Product', [i.productId], ['PRODUCT_PHOTO']);
          photoUrl = photos[i.productId]?.[0]?.downloadUrl ?? null;
        }
        return {
          kind: i.kind,
          nameSnapshot: i.nameSnapshot,
          descriptionSnapshot: i.descriptionSnapshot,
          quantity: Number(i.quantity),
          unit: i.unit,
          unitPrice: Number(i.unitPrice),
          discountPercent: Number(i.discountPercent),
          discountAmount: Number(i.discountAmount),
          total: Number(i.total),
          article,
          photoUrl,
        };
      }),
    );

    const html = this.rendererService.renderHtml({
      number: quotation.number,
      createdAt: version.createdAt,
      validUntil: version.validUntil,
      currency: version.currency,
      customer: {
        name: customer?.name ?? '',
        contactPerson: customer?.contactPerson ?? null,
        phone: customer?.phone ?? null,
        email: customer?.email ?? null,
        address: customer?.address ?? null,
      },
      items: renderItems,
      subtotal: Number(version.subtotal),
      discountAmount: Number(version.discountAmount),
      total: Number(version.total),
      paymentTerms: version.paymentTerms,
      deliveryTerms: version.deliveryTerms,
      installationTerms: version.installationTerms,
      notes: version.notes,
      companyDetailsText: companySnapshot.companyDetailsText,
      accentColor: templateSnapshot?.accentColor ?? null,
      logoUrl,
      visibleBlocks: (templateSnapshot?.visibleBlocks as Record<string, boolean>) ?? {},
    });

    return { html, template, templateSnapshot, companySnapshot };
  }

  /**
   * Live preview for the editor's right-hand pane (§8) — works on the
   * CURRENT version whether it's an editable DRAFT or an already-SENT
   * lock, always reflecting whatever is actually saved (saveItems commits
   * before this would show anything different — there's no separate
   * "unsaved changes" preview, matching the DRAFT-is-live-until-sentAt
   * model the rest of this service already uses).
   */
  async previewHtml(user: RequestUser, quotationId: string): Promise<string> {
    const quotation = await this.prisma.tenant.quotation.findUnique({ where: { id: quotationId } });
    if (!quotation) throw new CodedNotFoundException('QUOTATION_NOT_FOUND', 'Quotation not found.');
    const version = await this.getCurrentVersion(quotationId);
    const items = await this.prisma.tenant.quotationVersionItem.findMany({ where: { quotationVersionId: version.id }, orderBy: { sortOrder: 'asc' } });
    const { html } = await this.renderVersionHtml(user, quotation, version, items);
    return html;
  }

  /** §6: the only way to change anything after send() — appends a fresh version, never mutates the sent one, and drops Quotation.status back to DRAFT for the new one to be worked on. */
  async createNewVersion(user: RequestUser, quotationId: string) {
    const current = await this.getCurrentVersion(quotationId);
    if (!current.sentAt) {
      throw new CodedConflictException('QUOTATION_VERSION_ALREADY_DRAFT', 'The current version is already an editable draft.');
    }

    const items = await this.prisma.tenant.quotationVersionItem.findMany({ where: { quotationVersionId: current.id }, orderBy: { sortOrder: 'asc' } });
    const newVersion = await this.prisma.tenant.quotationVersion.create({
      data: {
        quotationId,
        versionNumber: current.versionNumber + 1,
        validUntil: current.validUntil,
        currency: current.currency,
        paymentTerms: current.paymentTerms,
        deliveryTerms: current.deliveryTerms,
        installationTerms: current.installationTerms,
        notes: current.notes,
        templateId: current.templateId,
        subtotal: current.subtotal,
        discountAmount: current.discountAmount,
        total: current.total,
        createdById: user.userId,
      } as any,
    });
    for (const item of items) {
      const { id, quotationVersionId, ...rest } = item as any;
      await this.prisma.tenant.quotationVersionItem.create({ data: { ...rest, quotationVersionId: newVersion.id } });
    }

    await this.prisma.tenant.quotation.update({ where: { id: quotationId }, data: { status: 'DRAFT' } });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'quotation.version_created',
      entityType: 'Quotation',
      entityId: quotationId,
      after: { versionNumber: newVersion.versionNumber, copiedFromVersionNumber: current.versionNumber },
    });

    return this.findOne(user, quotationId);
  }

  /** §11: a genuinely new document — new id, new number, new DRAFT version #1 — never a version of the source. */
  async duplicate(user: RequestUser, quotationId: string) {
    const source = await this.findOne(user, quotationId);
    const sourceVersion = source.currentVersion;

    const number = await this.numberingService.nextQuotationNumber(user);
    const newQuotation = await this.prisma.tenant.quotation.create({
      data: { number, customerId: source.customerId, status: 'DRAFT', duplicatedFromId: source.id, createdById: user.userId } as any,
    });
    const newVersion = await this.prisma.tenant.quotationVersion.create({
      data: {
        quotationId: newQuotation.id,
        versionNumber: 1,
        validUntil: sourceVersion.validUntil,
        currency: sourceVersion.currency,
        paymentTerms: sourceVersion.paymentTerms,
        deliveryTerms: sourceVersion.deliveryTerms,
        installationTerms: sourceVersion.installationTerms,
        notes: sourceVersion.notes,
        templateId: sourceVersion.templateId,
        subtotal: sourceVersion.subtotal,
        discountAmount: sourceVersion.discountAmount,
        total: sourceVersion.total,
        createdById: user.userId,
      } as any,
    });
    for (const item of sourceVersion.items) {
      const { id, quotationVersionId, belowCostApproved, belowCostApprovedById, ...rest } = item as any;
      // Approval is deliberately NOT copied — a duplicate is a fresh
      // decision point (possibly different prices later), so any below-cost
      // line starts unapproved again in the new document.
      await this.prisma.tenant.quotationVersionItem.create({ data: { ...rest, quotationVersionId: newVersion.id, belowCostApproved: false, belowCostApprovedById: null } });
    }

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'quotation.duplicated',
      entityType: 'Quotation',
      entityId: newQuotation.id,
      after: { duplicatedFromId: source.id, number },
    });

    return this.findOne(user, newQuotation.id);
  }

  async markViewed(user: RequestUser, quotationId: string) {
    const quotation = await this.prisma.tenant.quotation.findUnique({ where: { id: quotationId } });
    if (!quotation) throw new CodedNotFoundException('QUOTATION_NOT_FOUND', 'Quotation not found.');
    if (quotation.status !== 'SENT') return this.findOne(user, quotationId); // idempotent no-op once already VIEWED/ACCEPTED/REJECTED — never regresses a later state back to VIEWED
    const version = await this.getCurrentVersion(quotationId);
    await this.prisma.tenant.quotationVersion.update({ where: { id: version.id }, data: { viewedAt: new Date() } });
    await this.prisma.tenant.quotation.update({ where: { id: quotationId }, data: { status: 'VIEWED' } });
    await this.auditService.record({ companyId: user.companyId, actorUserId: user.userId, action: 'quotation.viewed', entityType: 'Quotation', entityId: quotationId });
    return this.findOne(user, quotationId);
  }

  async accept(user: RequestUser, quotationId: string) {
    return this.decide(user, quotationId, 'ACCEPTED');
  }

  async reject(user: RequestUser, quotationId: string) {
    return this.decide(user, quotationId, 'REJECTED');
  }

  /** §6: ACCEPTED/REJECTED must point at a SPECIFIC version — recorded as that version's own acceptedAt/rejectedAt, not just a status flag on Quotation, so "which version was actually accepted" is never ambiguous even after later versions exist. */
  private async decide(user: RequestUser, quotationId: string, outcome: 'ACCEPTED' | 'REJECTED') {
    const quotation = await this.prisma.tenant.quotation.findUnique({ where: { id: quotationId } });
    if (!quotation) throw new CodedNotFoundException('QUOTATION_NOT_FOUND', 'Quotation not found.');
    if (quotation.status !== 'SENT' && quotation.status !== 'VIEWED') {
      throw new CodedConflictException('QUOTATION_NOT_DECIDABLE', 'Only a SENT or VIEWED quotation can be accepted or rejected.');
    }
    const version = await this.getCurrentVersion(quotationId);
    await this.prisma.tenant.quotationVersion.update({
      where: { id: version.id },
      data: outcome === 'ACCEPTED' ? { acceptedAt: new Date() } : { rejectedAt: new Date() },
    });
    await this.prisma.tenant.quotation.update({ where: { id: quotationId }, data: { status: outcome } });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: outcome === 'ACCEPTED' ? 'quotation.accepted' : 'quotation.rejected',
      entityType: 'Quotation',
      entityId: quotationId,
      after: { versionId: version.id, versionNumber: version.versionNumber },
    });
    return this.findOne(user, quotationId);
  }

  /**
   * §12: only from an ACCEPTED quotation, only once, always from the
   * ACCEPTED version's own frozen snapshot — never re-pulling live Assembly
   * prices. Requiring `status === 'ACCEPTED'` (rather than just "some
   * version has acceptedAt") also guarantees getCurrentVersion() IS the
   * accepted version: createNewVersion() flips status back to DRAFT the
   * moment it runs, so an accepted-then-superseded version can never be
   * the one silently used here.
   *
   * CustomerOrderItem has no price field and no non-ASSEMBLY line concept
   * at all (schema fact, not an oversight) — a Quotation's SERVICE/
   * DELIVERY/INSTALLATION/CUSTOM/PRODUCT lines have no structural home on
   * a CustomerOrder. Rather than silently dropping that money: DELIVERY
   * lines fold into CustomerOrder.deliveryCost (a field that already
   * exists for exactly this), everything else non-ASSEMBLY folds into
   * otherCost, and `comment` lists what those totals represent so nothing
   * is invisible. A deleted/soft-deleted Assembly is skipped with a
   * warning rather than failing the whole conversion (§12's own
   * "handle gracefully" requirement) — the resulting warnings are
   * returned to the caller for the UI to surface, not swallowed.
   */
  async convertToOrder(user: RequestUser, quotationId: string) {
    const quotation = await this.prisma.tenant.quotation.findUnique({ where: { id: quotationId } });
    if (!quotation) throw new CodedNotFoundException('QUOTATION_NOT_FOUND', 'Quotation not found.');
    if (quotation.status !== 'ACCEPTED') {
      throw new CodedConflictException('QUOTATION_NOT_ACCEPTED', 'Only an ACCEPTED quotation can be converted to a customer order.');
    }
    if (quotation.convertedCustomerOrderId) {
      throw new CodedConflictException('QUOTATION_ALREADY_CONVERTED', 'This quotation was already converted to a customer order.');
    }

    const version = await this.getCurrentVersion(quotationId);
    const items = await this.prisma.tenant.quotationVersionItem.findMany({ where: { quotationVersionId: version.id }, orderBy: { sortOrder: 'asc' } });
    const customer = await this.prisma.tenant.customer.findUnique({ where: { id: quotation.customerId } });

    const orderItems: { assemblyId: string; qty: number }[] = [];
    const warnings: string[] = [];
    let deliveryCostFromItems = 0;
    let otherCostFromItems = 0;
    const otherCostDescriptions: string[] = [];

    for (const item of items) {
      if (item.kind === 'ASSEMBLY') {
        const assembly = item.assemblyId ? await this.prisma.tenant.assembly.findUnique({ where: { id: item.assemblyId } }) : null;
        if (!assembly || assembly.deletedAt) {
          warnings.push(`«${item.nameSnapshot}» — виріб більше недоступний (видалений), лінію пропущено. Додайте позицію в замовлення вручну.`);
          continue;
        }
        orderItems.push({ assemblyId: item.assemblyId!, qty: Number(item.quantity) });
      } else if (item.kind === 'DELIVERY') {
        deliveryCostFromItems += Number(item.total);
      } else {
        otherCostFromItems += Number(item.total);
        otherCostDescriptions.push(`${item.nameSnapshot} — ${item.total} ${version.currency}`);
      }
    }

    if (orderItems.length === 0) {
      throw new CodedConflictException('QUOTATION_NO_CONVERTIBLE_ITEMS', 'No assembly line survived conversion — nothing to build a production order from.');
    }

    const comment = otherCostDescriptions.length > 0
      ? `Створено з КП ${quotation.number}. Позиції без виробничого відповідника (включено в "Інші витрати"): ${otherCostDescriptions.join('; ')}`
      : `Створено з КП ${quotation.number}.`;

    const order = await this.customerOrdersService.create(user, {
      orderNumber: quotation.number,
      customerId: quotation.customerId,
      clientName: customer?.name ?? '',
      deliveryCost: deliveryCostFromItems || undefined,
      otherCost: otherCostFromItems || undefined,
      comment,
      items: orderItems.map((i) => ({ assemblyId: i.assemblyId, qty: i.qty })),
    } as any);

    await this.prisma.tenant.customerOrder.update({
      where: { id: order.id },
      data: { sourceQuotationId: quotation.id, sourceQuotationVersionId: version.id },
    });
    await this.prisma.tenant.quotation.update({ where: { id: quotationId }, data: { convertedCustomerOrderId: order.id } });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'quotation.converted_to_order',
      entityType: 'Quotation',
      entityId: quotationId,
      after: { customerOrderId: order.id, warnings },
    });

    return { customerOrderId: order.id, warnings };
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Renders Settings → "Реквізити компанії" into the same free-text block a
 * QuotationTemplate.companyDetailsText override would occupy (see
 * QuotationRendererService's `.company-details` — `white-space: pre-line`,
 * so `\n` here is a real line break in the PDF). Returns null when nothing
 * is filled in yet, same as an unset template override — the renderer
 * already omits the whole block in that case.
 */
function formatRequisitesText(r: { legalName: string | null; taxId: string | null; legalAddress: string | null; phone: string | null; email: string | null; bankName: string | null; bankIban: string | null; bankMfo: string | null; website: string | null } | null): string | null {
  if (!r) return null;
  const lines: string[] = [];
  if (r.legalName) lines.push(r.taxId ? `${r.legalName}, ЄДРПОУ/ІПН: ${r.taxId}` : r.legalName);
  else if (r.taxId) lines.push(`ЄДРПОУ/ІПН: ${r.taxId}`);
  if (r.legalAddress) lines.push(r.legalAddress);
  const contact = [r.phone, r.email].filter(Boolean).join('   ');
  if (contact) lines.push(contact);
  if (r.bankName || r.bankIban || r.bankMfo) {
    const bank = [r.bankName, r.bankIban ? `IBAN: ${r.bankIban}` : null, r.bankMfo ? `МФО: ${r.bankMfo}` : null].filter(Boolean).join(', ');
    lines.push(bank);
  }
  if (r.website) lines.push(r.website);
  return lines.length > 0 ? lines.join('\n') : null;
}
