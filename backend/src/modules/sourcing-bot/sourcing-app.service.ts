import { Injectable } from '@nestjs/common';
import { PrismaService, TenantPrismaClient } from '../../prisma/prisma.service';
import { FilesService } from '../files/files.service';
import { AiSettingsService } from '../ai/ai-settings.service';
import { GeminiAdapter } from '../ai/providers/gemini.adapter';
import { AiProviderException } from '../ai/providers/ai-provider.port';
import { CodedBadRequestException, CodedForbiddenException, CodedNotFoundException } from '../../common/api-exceptions';
import { ResolvedSourcingIdentity } from './sourcing-identity.service';
import { PRICE_FIELDS, STATUS_LABELS, priceNumber } from './sourcing-shared';
import { UpdateOutreachDto } from './dto/update-outreach.dto';
import { CreateCandidateDto } from './dto/create-candidate.dto';

const APP_PAGE_SIZE = 30;

/** Sentinel categoryId for the Mini App's synthetic "Всі товари" entry (2026-11-10 — "в категоріях має бути категорія всі щоб просто гортати всі товари") — no real SourcingCategory has this id, so it can never collide with one. */
export const ALL_CATEGORIES_ID = 'all';

function tenantCtx(identity: ResolvedSourcingIdentity) {
  return { companyId: identity.companyId, userId: identity.userId };
}

/** Shared by category-product-list and search rows — a lean projection, not the full detail card. */
export interface ProductRow {
  id: string;
  article: string;
  name: string;
  photoUrl: string | null;
  prices: Array<{ field: string; icon: string; label: string; value: number }>;
  supplierCount: number;
}

/**
 * Backend for the Mini App (2026-11-10 — "веб версію як застосунок") —
 * read-mostly endpoints mirroring exactly what `SourcingBotService`'s chat
 * flow already shows (same `PRICE_FIELDS`/`STATUS_LABELS`, same
 * most-recent-photo rule, same category-scoped candidate suppliers), just
 * returned as JSON for a UI to render instead of formatted chat messages.
 */
@Injectable()
export class SourcingAppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly filesService: FilesService,
    private readonly aiSettingsService: AiSettingsService,
    private readonly geminiAdapter: GeminiAdapter,
  ) {}

  async getCategories(identity: ResolvedSourcingIdentity) {
    return this.prisma.runInTenantTransaction(tenantCtx(identity), (tx) =>
      tx.sourcingCategory.findMany({
        where: { deletedAt: null },
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          code: true,
          name: true,
          _count: { select: { products: { where: { deletedAt: null } } } },
        },
      }),
    ).then((categories) =>
      categories.map((c) => ({ id: c.id, code: c.code, name: c.name, productCount: c._count.products })),
    );
  }

  /** Most-recent `PRODUCT_PHOTO` per product id, as presigned URLs — one batched lookup per page instead of N+1. */
  private async photoUrlsByProductId(tx: TenantPrismaClient, identity: ResolvedSourcingIdentity, productIds: string[]): Promise<Map<string, string>> {
    if (productIds.length === 0) return new Map();
    const photos = await tx.fileAsset.findMany({
      where: { entityType: 'Product', entityId: { in: productIds }, domain: 'PRODUCT_PHOTO', deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, entityId: true },
    });
    const photoIdByProductId = new Map<string, string>();
    for (const p of photos) if (!photoIdByProductId.has(p.entityId)) photoIdByProductId.set(p.entityId, p.id);

    const urlByProductId = new Map<string, string>();
    await Promise.all(
      [...photoIdByProductId.entries()].map(async ([productId, photoId]) => {
        const { downloadUrl } = await this.filesService.getDownloadUrl({ userId: identity.userId, companyId: identity.companyId }, photoId);
        urlByProductId.set(productId, downloadUrl);
      }),
    );
    return urlByProductId;
  }

  /** ALL `PRODUCT_PHOTO` rows for ONE product, newest first, as presigned URLs — unlike `photoUrlsByProductId` (list views, one thumbnail each), the product-detail card shows every photo ever uploaded for a gallery/lightbox, not just the latest. */
  private async allPhotoUrlsForProduct(tx: TenantPrismaClient, identity: ResolvedSourcingIdentity, productId: string): Promise<string[]> {
    const photos = await tx.fileAsset.findMany({
      where: { entityType: 'Product', entityId: productId, domain: 'PRODUCT_PHOTO', deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return Promise.all(
      photos.map(async (p) => (await this.filesService.getDownloadUrl({ userId: identity.userId, companyId: identity.companyId }, p.id)).downloadUrl),
    );
  }

  /**
   * A usable 3D model PLUS any PDF/DXF among this product's own
   * `PRODUCT_DOCUMENT` files (2026-11-10 — "і 3д" / "щоб у картку товару
   * підтягувався пдф файл і dxf якщо вони є"). Products never get a
   * dedicated 3D-model upload slot — a `.glb` or `.step` (auto-converted
   * to `.glb` by StepConversionService) simply lives among the product's
   * own documents, same as the BOM/Assembly 3D pipeline. One batched
   * `listForEntities` call serves both: `listForEntities` already
   * resolves every conversion/optimization variant to a presigned URL
   * (see its own header comments) — the model URL applies the same
   * precedence `ArViewButton`/the BOM 3D viewer use (optimized >
   * mobile-optimized > STEP-converted > already-.glb); the PDF/DXF list
   * excludes whatever file that model URL came from, so the same file
   * never shows up twice (once as "🧊 3D", once again as a plain
   * document link).
   */
  private async findModelAndDocuments(
    identity: ResolvedSourcingIdentity,
    productId: string,
  ): Promise<{ modelUrl: string | null; documents: Array<{ id: string; name: string; url: string }> }> {
    const byProductId = await this.filesService.listForEntities(
      { userId: identity.userId, companyId: identity.companyId },
      'Product',
      [productId],
      ['PRODUCT_DOCUMENT'],
    );
    const files = byProductId[productId] ?? [];

    let modelUrl: string | null = null;
    let modelFileId: string | null = null;
    for (const file of files) {
      const url = file.optimizedDownloadUrl ?? file.mobileOptimizedDownloadUrl ?? file.convertedDownloadUrl ?? (/\.glb$/i.test(file.originalName) ? file.downloadUrl : undefined);
      if (url) {
        modelUrl = url;
        modelFileId = file.id;
        break;
      }
    }

    const documents = files
      .filter((f) => f.id !== modelFileId && /\.(pdf|dxf)$/i.test(f.originalName))
      .map((f) => ({ id: f.id, name: f.originalName, url: f.downloadUrl }));

    return { modelUrl, documents };
  }

  private toPriceList(product: Record<string, unknown>): ProductRow['prices'] {
    return PRICE_FIELDS.map(({ field, icon, label }) => {
      const value = priceNumber(product[field]);
      return value === null ? null : { field, icon, label, value };
    }).filter((x): x is NonNullable<typeof x> => x !== null);
  }

  private readonly productRowSelect = {
    id: true,
    article: true,
    name: true,
    germanPriceExclVat: true,
    germanPriceInclVat: true,
    localPriceExclVat: true,
    localPriceInclVat: true,
    sellPriceEur: true,
    _count: { select: { suppliers: true } },
  } as const;

  /** Shared by category/assembly product lists and search — one `where` clause in, one paginated+photo-attached `ProductRow[]` out. Not used by `getProductDetail`'s own full card, which needs more fields than this lean projection. */
  private async queryProductRows(
    tx: TenantPrismaClient,
    identity: ResolvedSourcingIdentity,
    where: Record<string, unknown>,
    pagination: { skip?: number; take?: number } = {},
  ): Promise<{ items: ProductRow[]; total: number }> {
    const [total, products] = await Promise.all([
      tx.product.count({ where }),
      tx.product.findMany({ where, orderBy: { article: 'asc' }, select: this.productRowSelect, ...pagination }),
    ]);
    const photoUrlByProductId = await this.photoUrlsByProductId(tx, identity, products.map((p) => p.id));
    const items: ProductRow[] = products.map((p) => ({
      id: p.id,
      article: p.article,
      name: p.name,
      photoUrl: photoUrlByProductId.get(p.id) ?? null,
      prices: this.toPriceList(p),
      supplierCount: p._count.suppliers,
    }));
    return { items, total };
  }

  async getCategoryProducts(identity: ResolvedSourcingIdentity, categoryId: string, search: string | undefined, page: number) {
    return this.prisma.runInTenantTransaction(tenantCtx(identity), async (tx) => {
      const where = {
        sourcingCategoryId: categoryId === ALL_CATEGORIES_ID ? { not: null } : categoryId,
        deletedAt: null,
        ...(search ? { OR: [{ article: { contains: search, mode: 'insensitive' as const } }, { name: { contains: search, mode: 'insensitive' as const } }] } : {}),
      };
      const { items, total } = await this.queryProductRows(tx, identity, where, { skip: page * APP_PAGE_SIZE, take: APP_PAGE_SIZE });
      return { items, total, page, pageSize: APP_PAGE_SIZE, hasMore: (page + 1) * APP_PAGE_SIZE < total };
    });
  }

  /**
   * "пошук товарів не по категоріям а по виробах... відкриваємо
   * [специфікацію] і у нас весь список товарів які в неї входять"
   * (2026-11-10) — every real `Assembly` ("специфікація"/виріб this
   * company manufactures), for a browse mode orthogonal to sourcing
   * categories. `componentCount` is the cheap DIRECT line count (for the
   * list screen only) — the real, recursively-flattened leaf product
   * list is computed on demand in `getAssemblyProducts` below, same
   * "cheap for the list, real query on drill-down" split as categories.
   */
  async getAssemblies(identity: ResolvedSourcingIdentity) {
    const assemblies = await this.prisma.runInTenantTransaction(tenantCtx(identity), (tx) =>
      tx.assembly.findMany({
        where: { deletedAt: null },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, article: true, _count: { select: { components: true } } },
      }),
    );
    return assemblies.map((a) => ({ id: a.id, name: a.name, article: a.article, componentCount: a._count.components }));
  }

  /**
   * Every DISTINCT real `Product` anywhere in `assemblyId`'s BOM tree, at
   * ANY depth — same recursive-flatten-with-cycle-guard shape as
   * `AssembliesService#flattenRequirements` (private there, so
   * reimplemented here rather than exported just for this one caller);
   * unlike that method this doesn't aggregate quantities — a sourcing
   * tool cares "which parts does this product need," not "how many of
   * each," so a plain distinct id set is enough.
   */
  private async flattenAssemblyProductIds(tx: TenantPrismaClient, assemblyId: string, visited: Set<string>): Promise<Set<string>> {
    const productIds = new Set<string>();
    if (visited.has(assemblyId)) return productIds;
    visited.add(assemblyId);

    const components = await tx.assemblyComponent.findMany({ where: { assemblyId } });
    for (const line of components) {
      if (line.componentType === 'PRODUCT' && line.productId) {
        productIds.add(line.productId);
      } else if (line.componentType === 'ASSEMBLY' && line.subAssemblyId) {
        const nested = await this.flattenAssemblyProductIds(tx, line.subAssemblyId, visited);
        for (const id of nested) productIds.add(id);
      }
    }
    return productIds;
  }

  async getAssemblyProducts(identity: ResolvedSourcingIdentity, assemblyId: string, search: string | undefined, page: number) {
    return this.prisma.runInTenantTransaction(tenantCtx(identity), async (tx) => {
      const productIds = [...(await this.flattenAssemblyProductIds(tx, assemblyId, new Set()))];
      if (productIds.length === 0) return { items: [], total: 0, page, pageSize: APP_PAGE_SIZE, hasMore: false };

      const where = {
        id: { in: productIds },
        deletedAt: null,
        ...(search ? { OR: [{ article: { contains: search, mode: 'insensitive' as const } }, { name: { contains: search, mode: 'insensitive' as const } }] } : {}),
      };
      const { items, total } = await this.queryProductRows(tx, identity, where, { skip: page * APP_PAGE_SIZE, take: APP_PAGE_SIZE });
      return { items, total, page, pageSize: APP_PAGE_SIZE, hasMore: (page + 1) * APP_PAGE_SIZE < total };
    });
  }

  async search(identity: ResolvedSourcingIdentity, query: string) {
    return this.prisma.runInTenantTransaction(tenantCtx(identity), async (tx) => {
      const products = await tx.product.findMany({
        where: {
          sourcingCategoryId: { not: null },
          deletedAt: null,
          OR: [{ article: { contains: query, mode: 'insensitive' } }, { name: { contains: query, mode: 'insensitive' } }],
        },
        orderBy: { article: 'asc' },
        take: APP_PAGE_SIZE,
        select: {
          id: true,
          article: true,
          name: true,
          germanPriceExclVat: true,
          germanPriceInclVat: true,
          localPriceExclVat: true,
          localPriceInclVat: true,
          sellPriceEur: true,
          _count: { select: { suppliers: true } },
        },
      });
      const photoUrlByProductId = await this.photoUrlsByProductId(tx, identity, products.map((p) => p.id));
      const items: ProductRow[] = products.map((p) => ({
        id: p.id,
        article: p.article,
        name: p.name,
        photoUrl: photoUrlByProductId.get(p.id) ?? null,
        prices: this.toPriceList(p),
        supplierCount: p._count.suppliers,
      }));
      return { items };
    });
  }

  /** Full detail card — same data `SourcingBotService#sendProductDetail` sends as a chat message, as JSON. */
  async getProductDetail(identity: ResolvedSourcingIdentity, productId: string) {
    const result = await this.prisma.runInTenantTransaction(tenantCtx(identity), async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: {
          id: true,
          article: true,
          name: true,
          sourcingCategoryId: true,
          germanPriceExclVat: true,
          germanPriceInclVat: true,
          localPriceExclVat: true,
          localPriceInclVat: true,
          sellPriceEur: true,
        },
      });
      if (!product) return null;

      const supplierLinks = await tx.productSupplier.findMany({
        where: { productId },
        select: { price: true, supplierOfferedPrice: true, supplier: { select: { id: true, name: true } } },
      });

      const photoUrls = await this.allPhotoUrlsForProduct(tx, identity, product.id);
      const { modelUrl, documents } = await this.findModelAndDocuments(identity, product.id);

      const candidates = product.sourcingCategoryId
        ? await tx.sourcingCandidateSupplier.findMany({
            where: { categoryId: product.sourcingCategoryId, deletedAt: null },
            include: { outreach: true },
            orderBy: { createdAt: 'asc' },
          })
        : [];

      const category = product.sourcingCategoryId
        ? await tx.sourcingCategory.findUnique({ where: { id: product.sourcingCategoryId }, select: { id: true, name: true, rfqTemplate: true } })
        : null;

      return { product, supplierLinks, photoUrls, modelUrl, documents, candidates, category };
    });

    if (!result) throw new CodedNotFoundException('SOURCING_PRODUCT_NOT_FOUND', 'Product not found.');
    const { product, supplierLinks, photoUrls, modelUrl, documents, candidates, category } = result;

    return {
      id: product.id,
      article: product.article,
      name: product.name,
      photoUrls,
      modelUrl,
      documents,
      prices: this.toPriceList(product),
      category: category ? { id: category.id, name: category.name, rfqTemplate: category.rfqTemplate } : null,
      realSuppliers: supplierLinks.map((link) => ({
        id: link.supplier.id,
        name: link.supplier.name,
        ourPrice: priceNumber(link.price),
        supplierOfferedPrice: priceNumber(link.supplierOfferedPrice),
      })),
      candidateSuppliers: candidates.map((c) => ({
        id: c.id,
        name: c.name,
        region: c.region,
        location: c.location,
        phone: c.phone,
        email: c.email,
        website: c.website,
        whatTheyDo: c.whatTheyDo,
        status: c.outreach?.status ?? 'NOT_CONTACTED',
        statusLabel: STATUS_LABELS[c.outreach?.status ?? 'NOT_CONTACTED'],
      })),
    };
  }

  /** Every real, already-onboarded Supplier linked to at least one tracked product, with their linked products. */
  async getSuppliers(identity: ResolvedSourcingIdentity) {
    const links = await this.prisma.runInTenantTransaction(tenantCtx(identity), (tx) =>
      tx.productSupplier.findMany({
        where: { product: { sourcingCategoryId: { not: null }, deletedAt: null } },
        select: {
          price: true,
          supplierOfferedPrice: true,
          supplier: { select: { id: true, name: true, phone: true, email: true } },
          product: { select: { id: true, article: true, name: true } },
        },
      }),
    );

    const bySupplierId = new Map<string, { id: string; name: string; phone: string | null; email: string | null; products: Array<{ id: string; article: string; name: string; ourPrice: number | null; supplierOfferedPrice: number | null }> }>();
    for (const link of links) {
      const existing = bySupplierId.get(link.supplier.id);
      const productEntry = {
        id: link.product.id,
        article: link.product.article,
        name: link.product.name,
        ourPrice: priceNumber(link.price),
        supplierOfferedPrice: priceNumber(link.supplierOfferedPrice),
      };
      if (existing) {
        existing.products.push(productEntry);
      } else {
        bySupplierId.set(link.supplier.id, { ...link.supplier, products: [productEntry] });
      }
    }
    return [...bySupplierId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async getCandidates(identity: ResolvedSourcingIdentity, categoryId?: string, region?: string) {
    const candidates = await this.prisma.runInTenantTransaction(tenantCtx(identity), (tx) =>
      tx.sourcingCandidateSupplier.findMany({
        where: {
          deletedAt: null,
          ...(categoryId ? { categoryId } : {}),
          ...(region ? { region } : {}),
        },
        include: { outreach: true, category: { select: { id: true, name: true } } },
        orderBy: [{ category: { sortOrder: 'asc' } }, { name: 'asc' }],
      }),
    );
    return candidates.map((c) => ({
      id: c.id,
      name: c.name,
      region: c.region,
      location: c.location,
      phone: c.phone,
      email: c.email,
      website: c.website,
      whatTheyDo: c.whatTheyDo,
      category: c.category,
      status: c.outreach?.status ?? 'NOT_CONTACTED',
      statusLabel: STATUS_LABELS[c.outreach?.status ?? 'NOT_CONTACTED'],
      lastNote: c.outreach?.lastNote ?? null,
      quotedPriceEur: priceNumber(c.outreach?.quotedPriceEur),
      quotedPriceNote: c.outreach?.quotedPriceNote ?? null,
    }));
  }

  /**
   * "має бути можливість додавати можливих постачальників" (2026-11-10) —
   * the Mini App's form equivalent of the bot's own admin-only
   * "➕ Додати постачальника" text flow (same ADMIN_PERMISSION_KEY check,
   * same two-separate-top-level-creates shape — see
   * SourcingBotService#handlePendingInput's `add_candidate` case for why
   * a nested `outreach: { create }` isn't used).
   */
  async createCandidate(identity: ResolvedSourcingIdentity, dto: CreateCandidateDto) {
    if (!identity.isAdmin) {
      throw new CodedForbiddenException('SOURCING_CANDIDATE_CREATE_FORBIDDEN', 'Only a procurement admin can add a new candidate supplier.');
    }
    return this.prisma.runInTenantTransaction(tenantCtx(identity), async (tx) => {
      // `as any` on both creates — same as SourcingBotService's own
      // add_candidate flow: the tenant-scoping extension auto-stamps
      // `companyId` onto the entry-point row of a top-level create, which
      // Prisma's generated input type doesn't reflect as optional.
      const candidate = await tx.sourcingCandidateSupplier.create({
        data: {
          categoryId: dto.categoryId,
          name: dto.name,
          region: dto.region ?? null,
          location: dto.location ?? null,
          phone: dto.phone ?? null,
          email: dto.email ?? null,
          website: dto.website ?? null,
          whatTheyDo: dto.whatTheyDo ?? null,
          source: 'user_added',
        } as any,
      });
      await tx.sourcingOutreach.create({ data: { candidateSupplierId: candidate.id, status: 'NOT_CONTACTED' } as any });
      return { id: candidate.id };
    });
  }

  /** Same writes as the bot's setstatus/note/quote_price+quote_note flows — see SourcingBotService's own comments for why a plain note edit does NOT stamp contactedByUserId/contactedAt but a status change or a quote does. */
  async updateOutreach(identity: ResolvedSourcingIdentity, candidateId: string, dto: UpdateOutreachDto) {
    const data: Record<string, unknown> = {};
    if (dto.status !== undefined) {
      data.status = dto.status;
      data.contactedByUserId = identity.userId;
      data.contactedAt = new Date();
    }
    if (dto.note !== undefined) data.lastNote = dto.note;
    if (dto.quotedPriceEur !== undefined) {
      data.quotedPriceEur = dto.quotedPriceEur;
      data.status = data.status ?? 'QUOTE_RECEIVED';
      data.contactedByUserId = identity.userId;
      data.contactedAt = new Date();
    }
    if (dto.quotedPriceNote !== undefined) data.quotedPriceNote = dto.quotedPriceNote;

    await this.prisma.runInTenantTransaction(tenantCtx(identity), (tx) =>
      tx.sourcingOutreach.update({
        where: { companyId_candidateSupplierId: { companyId: identity.companyId, candidateSupplierId: candidateId } },
        data,
      }),
    );
    return { updated: true };
  }

  async getStatusOverview(identity: ResolvedSourcingIdentity) {
    const candidates = await this.prisma.runInTenantTransaction(tenantCtx(identity), (tx) =>
      tx.sourcingCandidateSupplier.findMany({
        where: { deletedAt: null },
        include: { outreach: true, category: { select: { name: true } } },
        orderBy: [{ category: { sortOrder: 'asc' } }, { name: 'asc' }],
      }),
    );
    const counts: Record<string, number> = {};
    for (const status of Object.keys(STATUS_LABELS)) counts[status] = 0;
    for (const c of candidates) {
      const status = c.outreach?.status ?? 'NOT_CONTACTED';
      counts[status] = (counts[status] ?? 0) + 1;
    }
    return {
      counts,
      items: candidates.map((c) => ({
        id: c.id,
        name: c.name,
        categoryName: c.category.name,
        status: c.outreach?.status ?? 'NOT_CONTACTED',
        statusLabel: STATUS_LABELS[c.outreach?.status ?? 'NOT_CONTACTED'],
      })),
    };
  }

  /**
   * "додай можливість перекладу назв товарів на українську" (2026-11-10)
   * — most product names in this catalog are German (imported from a
   * German supplier, see expand-sourcing-catalog.ts), so an on-demand,
   * per-name translate button is far more useful than nothing. Uses the
   * SAME platform-provided Gemini key the main ERP's AI module falls
   * back to (`AiSettingsService#getGeminiApiKey` — per-company key if the
   * company ever sets one, else `AI_PLATFORM_API_KEY`) — but deliberately
   * injects `AiSettingsService`/`GeminiAdapter` directly here rather than
   * importing the full `AiModule`, which transitively pulls in Bom/Sales/
   * Inventory/Hr/Reports (its tool registry's dependencies) — exactly the
   * kind of heavy, unrelated coupling this standalone process's isolation
   * is meant to avoid (see sourcing-bot.module.ts's own header comment).
   * Deliberately skips `AiActionsService`'s quota/usage-logging (that
   * machinery needs the tool registry too) — a single short product-name
   * translation is negligible token volume next to the chat
   * assistant/invoice-OCR features that system actually guards against.
   */
  async translateName(identity: ResolvedSourcingIdentity, text: string): Promise<{ translated: string }> {
    const apiKey = await this.aiSettingsService.getGeminiApiKey(identity.companyId);
    const prompt =
      'Переклади цю технічну назву деталі/товару українською мовою. ' +
      'Поверни ТІЛЬКИ переклад, без пояснень і без лапок. ' +
      'Якщо це вже українською — поверни без змін. ' +
      'Збережи числа, артикули та розміри як є.\n\n' +
      text;
    try {
      const result = await this.geminiAdapter.generateContent([{ role: 'user', parts: [{ text: prompt }] }], apiKey);
      const translated = result.message.parts.find((p) => p.text !== undefined)?.text?.trim();
      if (!translated) throw new CodedBadRequestException('SOURCING_TRANSLATE_EMPTY', 'Переклад не вдався — порожня відповідь.');
      return { translated };
    } catch (err) {
      if (err instanceof AiProviderException) {
        throw new CodedBadRequestException('SOURCING_TRANSLATE_FAILED', err.message);
      }
      throw err;
    }
  }
}
