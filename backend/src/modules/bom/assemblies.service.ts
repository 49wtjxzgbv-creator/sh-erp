import { Injectable } from '@nestjs/common';
import { ComponentType, Currency, Prisma } from '@prisma/client';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { CodedBadRequestException, CodedConflictException, CodedNotFoundException } from '../../common/api-exceptions';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StockService } from '../inventory/stock.service';
import { SubAssemblyReservationService, SubAssemblyReservationBreakdownLine } from '../inventory/sub-assembly-reservation.service';
import { ExchangeRatesService } from '../finance/exchange-rates.service';
import { AssemblyComponentLineDto, SetAssemblyComponentsDto } from './dto/assembly-component.dto';
import { SetAssemblySuppliersDto } from './dto/assembly-supplier.dto';
import { CreateAssemblyDto, UpdateAssemblyDto } from './dto/assembly.dto';
import { ProduceAssemblyDto } from './dto/produce-assembly.dto';
import { QueryAssembliesDto } from './dto/query-assemblies.dto';

export interface CostBreakdownLine {
  componentType: 'PRODUCT' | 'ASSEMBLY';
  productId?: string;
  subAssemblyId?: string;
  qtyPerUnit: number;
  unitCost: number;
  lineCost: number;
}

export interface AssemblyCostResult {
  assemblyId: string;
  costPerUnit: number;
  /** The currency `costPerUnit` (and every `breakdown[].lineCost`) is actually expressed in — this assembly's own `currency`. A caller combining this with another assembly's cost (e.g. a parent summing a sub-assembly's result) MUST convert first if the two differ; nothing upstream of this method does that conversion for you. */
  currency: Currency;
  breakdown: CostBreakdownLine[];
}

export interface WeightBreakdownLine {
  componentType: 'PRODUCT' | 'ASSEMBLY';
  productId?: string;
  subAssemblyId?: string;
  qtyPerUnit: number;
  /** `null` means "not set" (Product.weightPerUnitKg is nullable), not "known to weigh 0" — distinguishes a genuinely weightless line from a gap in the data. For an ASSEMBLY line, this is the sub-assembly's own `weightPerUnitKg` (0 if every one of ITS lines is also missing). */
  unitWeightKg: number | null;
  lineWeightKg: number;
  /** False if `unitWeightKg` is null, or (for an ASSEMBLY line) if the sub-assembly's own calculation wasn't complete either — propagates up so a gap anywhere in the tree surfaces at the top. */
  complete: boolean;
}

/** Weighed from Product.weightPerUnitKg — missing values contribute 0 to `weightPerUnitKg` (never silently treated as "confirmed zero"), with `complete: false` flagging that the total understates reality. See `WeightBreakdownLine` for how a gap at any BOM depth propagates. */
export interface AssemblyWeightResult {
  assemblyId: string;
  weightPerUnitKg: number;
  complete: boolean;
  breakdown: WeightBreakdownLine[];
}

export interface GermanPriceBreakdownLine {
  componentType: 'PRODUCT' | 'ASSEMBLY';
  productId?: string;
  subAssemblyId?: string;
  qtyPerUnit: number;
  /** PRODUCT line: Product.germanPriceInclVat as-is. ASSEMBLY line: the sub-assembly's OWN manually-entered germanPriceEur, read directly — NOT a further recursive rollup of ITS components (see calcAssemblyGermanPriceFromBom's own header comment for why one level is correct here, unlike cost/weight). `null` = not set, not a confirmed zero. */
  unitGermanPrice: number | null;
  lineGermanPrice: number;
  complete: boolean;
}

/** Sum of this assembly's DIRECT BOM lines' own German prices — see calcAssemblyGermanPriceFromBom's header comment for why this is one level deep, unlike the recursive cost/weight calculations above. Missing values contribute 0, with `complete: false` flagging the gap. */
export interface AssemblyGermanPriceResult {
  assemblyId: string;
  germanPricePerUnit: number;
  complete: boolean;
  breakdown: GermanPriceBreakdownLine[];
}

export interface CostVsGermanPriceLine {
  componentType: 'PRODUCT' | 'ASSEMBLY';
  productId?: string;
  subAssemblyId?: string;
  qtyPerUnit: number;
  /** PRODUCT: Product.sellPriceEur. ASSEMBLY: that sub-assembly's own FULL recursive cost (calculateCost), not a one-level read — see compareCostToGermanPrice's own header comment for why cost stays deep while German price stays shallow. */
  unitCost: number;
  /** PRODUCT: Product.germanPriceInclVat. ASSEMBLY: the sub-assembly's own stored germanPriceEur, read directly, never recursed into. `null` = not set, not a confirmed zero. */
  unitGermanPrice: number | null;
  lineCost: number;
  lineGermanPrice: number;
  /** lineGermanPrice − lineCost — positive means this line's German reference is above what it actually costs us; negative means the opposite (a real signal worth investigating, not just rounding noise). */
  lineDelta: number;
  germanPriceMissing: boolean;
}

/**
 * "додай можливість робити такий звіт у будь якій специфікації" (2026-10-17)
 * — the line-by-line cost-vs-German-price breakdown worked out by hand for
 * article 279785, now available for any assembly. See
 * compareCostToGermanPrice's own header comment for the full reasoning
 * (deep cost + shallow German read, staleness detection).
 */
export interface AssemblyCostVsGermanPriceResult {
  assemblyId: string;
  /** Full recursive cost — identical to AssemblyCostResult.costPerUnit for the same assembly. */
  costPerUnit: number;
  /** This assembly's OWN labor/packaging/delivery/other costs — included in costPerUnit above, but with no German-price equivalent at all (no "labor cost in Germany" concept exists), so shown separately to explain part of any gap structurally rather than leaving it a mystery. */
  ownLaborCost: number;
  ownPackagingCost: number;
  ownDeliveryCost: number;
  ownOtherCost: number;
  /** Assembly.germanPriceEur as currently saved — whatever the cost/German-price summary cards actually display today. `null` if never set. */
  storedGermanPriceEur: number | null;
  /** What calculateGermanPriceFromBom would produce RIGHT NOW, one level deep, summed from `lines` below. */
  freshGermanPricePerUnit: number;
  freshGermanPriceComplete: boolean;
  /** True when storedGermanPriceEur no longer matches a fresh recalculation (beyond rounding) — the saved figure silently went stale after a component price or a sub-assembly's own German price changed, and nobody re-applied the calculator since. */
  isStoredGermanPriceStale: boolean;
  lines: CostVsGermanPriceLine[];
}

export interface AvailabilityResult {
  assemblyId: string;
  qty: number;
  sufficient: boolean;
  requirements: Array<{ productId: string; needed: number }>;
  shortages: Array<{ productId: string; needed: number; available: number; shortage: number }>;
}

export interface SubAssemblyNeed {
  assemblyId: string;
  name: string;
  article: string | null;
  /** Total qty of this sub-assembly needed across every branch of the BOM tree it appears in. */
  qtyNeeded: number;
  /** Current IN_STOCK FinishedGood count for this sub-assembly. */
  qtyInStock: number;
  /** Sum of every OTHER (already-existing) order's "Зі складу" claim on this assembly — see SubAssemblyReservation. */
  reservedByOthers: number;
  /** Per-order breakdown backing reservedByOthers, for "заброньовано для замовлення №..." display. */
  reservedBreakdown: SubAssemblyReservationBreakdownLine[];
}

export interface ProductionTreeNode {
  assemblyId: string;
  name: string;
  article: string | null;
  /** Qty of THIS node needed at this exact point in the tree (already multiplied down from the root). */
  qtyNeeded: number;
  /** Current IN_STOCK FinishedGood count for this node's own assembly. */
  qtyInStock: number;
  /** qtyInStock >= ceil(qtyNeeded) — same physical-whole-unit rounding start() uses for FIFO sub-assembly consumption. */
  done: boolean;
  /**
   * This node's own labor fund at current BOM rates: assembly.laborCostPerUnit
   * x the SHORTFALL only — max(qtyNeeded - qtyClaimedFromStock, 0), not the
   * raw qtyNeeded (2026-08-30 fix — "Оцінка по виробах" was showing a full
   * labor estimate for sub-assemblies that already have enough stock on
   * hand, purchased ready-made or otherwise, so nobody will actually be paid
   * to make more of them for this order).
   *
   * `qtyClaimedFromStock` is THIS order's own SubAssemblyReservation claim
   * ("Зі складу" choice made in the "Підвироби" dialog at order creation) —
   * deliberately NOT the live/global `qtyInStock` `done` uses above
   * (2026-08-31 fix — "оцінка... це орієнтир скільки коштуватиме, це не
   * повинно бути пов'язано зі складом, якщо ми не обрали вироби зі складу
   * при створенні замовлення"). Using live stock made the estimate drift
   * down over time as THIS SAME order's own batches got confirmed — the
   * estimate ate its own tail, converging toward the already-tracked
   * `actual`/`earnedActual` instead of staying a stable budget reference.
   * The reservation claim only ever changes when explicitly re-claimed or
   * consumed at a batch's own start() (SubAssemblyReservationService#consume),
   * never as a side effect of unrelated stock/confirmation activity — same
   * "own labor only, not recursive" fund every ProductionOrder freezes at
   * start() (production-orders.service.ts's `ownLabor`). See
   * CustomerOrdersService#getPayrollFundSummary for the estimated-vs-actual
   * pairing.
   *
   * 2026-09-17 fix ("вироби які ми вказали що купимо готові попали в
   * Оцінено", then "оцінено це має бути тільки те що робитимуть працівники
   * а не купили готове"): `qtyClaimedFromStock` here comes from
   * `getClaimedIncludingConsumedForOrder`, NOT the plain live claim — an
   * earlier attempt at this fix reused the same `qtyConsumedForThisOrder`
   * (FinishedGood-count) signal `done` uses above, but that counts ANY
   * consumption of this assembly for this order, including a MANUFACTURED
   * (never claimed "Зі складу") sub-assembly that later gets FIFO-consumed
   * into its own parent's batch — which wrongly zeroed real, planned labor
   * the moment production got that far. `getClaimedIncludingConsumedForOrder`
   * is scoped precisely to THIS claim's own history (live `qty` +
   * SubAssemblyReservation's own `consumedQty`), so a manufactured node
   * with no claim at all stays completely unaffected.
   *
   * Real order #441639 (articles 264112/264193) then showed the OPPOSITE
   * gap: those sub-assemblies were bought ready-made through ordinary
   * procurement — never through the "Підвироби" dialog at all — so no
   * SubAssemblyReservation ever existed for them, and `qtyClaimedFromStock`
   * stayed 0 despite 100% of what got consumed for this order being
   * PURCHASED (`productionOrderId: null`) units, never manufactured ones.
   * `qtyPurchasedInStock`/`qtyPurchasedConsumedForThisOrder` cover this
   * second, dialog-independent path: they credit purchased units directly
   * by their own physical origin (same `productionOrderId: null` rule
   * `done`'s own OR-clause and FinishedGood's schema comment use), whether
   * still sitting on the shelf or already consumed into this order's own
   * production — while a MANUFACTURED sub-assembly (`productionOrderId`
   * set) never qualifies for either credit and keeps charging its real
   * labor, satisfying both reports at once: "тільки те що робитимуть
   * працівники" gets charged, "куплене готове" — by claim OR by physical
   * origin — never does.
   */
  laborFundEstimate: number;
  /** This node's own ASSEMBLY-type components, same shape, recursively — [] for a leaf (no sub-assemblies). */
  children: ProductionTreeNode[];
}

/**
 * BOM module (Assemblies.gs, Phase 1 §3.3). Ports:
 *  - Full BOM CRUD (Assembly header + AssemblyComponent lines).
 *  - Immutable version snapshot on every BOM save (saveAssemblyVersionSnapshot_).
 *  - Recursive cost calculation (calcAssemblyCost_) — cycle-protected via a
 *    per-path visited set, same technique the legacy code used, but paired
 *    here with a save-time cycle *rejection* (see setComponents) rather than
 *    the legacy's silent truncation (Phase 1 §10.5's documented weakness).
 *  - Recursive component-requirement flattening + availability checking, and
 *    the reservation-free "produce" path (Assemblies.produceAssembly) that
 *    immediately checks availability and consumes components on the spot —
 *    distinct from, and preserved alongside, the full reserve→start
 *    ProductionOrder lifecycle landing in Module 6 (Phase 1 §6.1: "two
 *    parallel make-a-product paths", never to be collapsed into one).
 *
 * Neither Assembly nor a sub-assembly carries its own stock ledger in this
 * schema (only FinishedGood does, and only via a full ProductionOrder) — so
 * every cost/availability/consumption calculation here flattens all the way
 * down to real Product leaves, regardless of a sub-assembly's
 * `defaultSupplierId`. That field only changes how the Sales module groups
 * shortages into purchase-order lines later (Phase 1 §6.3); it is
 * deliberately NOT consulted by this module.
 */
@Injectable()
export class AssembliesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly stockService: StockService,
    private readonly subAssemblyReservationService: SubAssemblyReservationService,
    private readonly exchangeRatesService: ExchangeRatesService,
  ) {}

  // ============================================================
  // CRUD
  // ============================================================

  async create(user: RequestUser, dto: CreateAssemblyDto) {
    // Multi-currency module phase 4 (2026-10-29) — defaults to this
    // company's own base currency, not a hardcoded EUR, when the caller
    // doesn't specify one explicitly.
    const currency = dto.currency ?? (await this.exchangeRatesService.getBaseCurrency(user.companyId));
    const assembly = await this.prisma.tenant.assembly.create({ data: { ...dto, currency } as any });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'assembly.created',
      entityType: 'Assembly',
      entityId: assembly.id,
      after: assembly,
    });
    return assembly;
  }

  async findOne(user: RequestUser, id: string) {
    const assembly = await this.prisma.tenant.assembly.findUnique({
      where: { id },
      include: { components: true },
    });
    if (!assembly) throw new CodedNotFoundException('PRODUCTION_ASSEMBLY_NOT_FOUND', 'Assembly not found.');
    return assembly;
  }

  /**
   * Many assemblies in one call by id — mirrors ProductsService#findByIds.
   * Added specifically to fix a real incident: printing a customer order's
   * full composition (assembly -> sub-assembly -> product, recursively)
   * fired one GET per node through individual useAssembly/useProduct
   * hooks, and a real order with 150+ leaf products blew straight through
   * the global per-client rate limit (100 req/60s) — the same failure
   * mode already fixed once for bulk product delete (products.service.ts's
   * own header comment). Names/articles for whichever requests got
   * 429'd never resolved, silently falling back to the raw id forever.
   */
  async findByIds(user: RequestUser, ids: string[]) {
    if (ids.length === 0) return [];
    return this.prisma.tenant.assembly.findMany({ where: { id: { in: ids } } });
  }

  async query(user: RequestUser, query: QueryAssembliesDto) {
    const where: Prisma.AssemblyWhereInput = {};
    if (!query.includeDeleted) where.deletedAt = null;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { article: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const take = query.limit ?? 50;
    const skip = query.offset ?? 0;

    const [items, total] = await Promise.all([
      this.prisma.tenant.assembly.findMany({ where, orderBy: { name: 'asc' }, take, skip }),
      this.prisma.tenant.assembly.count({ where }),
    ]);

    return { items, total, limit: take, offset: skip };
  }

  async update(user: RequestUser, id: string, dto: UpdateAssemblyDto) {
    const before = await this.findOne(user, id);
    const assembly = await this.prisma.tenant.assembly.update({ where: { id }, data: dto as any });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'assembly.updated',
      entityType: 'Assembly',
      entityId: id,
      before,
      after: assembly,
    });
    return assembly;
  }

  /** Soft delete only — matches the Product convention (Phase 3 §1). */
  async remove(user: RequestUser, id: string) {
    const before = await this.findOne(user, id);
    const assembly = await this.prisma.tenant.assembly.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'assembly.deleted',
      entityType: 'Assembly',
      entityId: id,
      before,
    });
    return assembly;
  }

  /**
   * "Дублювати специфікацію" (2026-10-07 user request — схожі вироби,
   * щоб не набирати по новому, а скопіювати й трохи відредагувати):
   * copies every header field plus the current BOM line list into a
   * brand-new Assembly, and immediately snapshots that copied BOM as
   * version 1 — mirrors setComponents' own version-creation, since
   * ProductionOrdersService#create refuses an assembly with zero saved
   * versions ("This assembly has no saved BOM yet"), so a copy with no
   * version would be unusable in production until someone re-saved its
   * BOM anyway. If the source itself has no components (never saved a
   * BOM), the copy correctly starts in that same state — no version is
   * created, matching the source's own "not yet usable" status.
   *
   * Deliberately does NOT copy photo/documents/suppliers: those describe
   * the ORIGINAL physical item, not the new one (a photo of the "left"
   * variant would be actively wrong shown under a "right" copy) — the
   * user adds those fresh for the duplicate, same as they'd set a new
   * article/name.
   */
  async duplicate(user: RequestUser, sourceId: string) {
    const source = await this.findOne(user, sourceId);

    const copy = await this.prisma.tenant.assembly.create({
      data: {
        name: `${source.name} (копія)`,
        article: source.article,
        note: source.note,
        laborCostPerUnit: source.laborCostPerUnit,
        packagingCostPerUnit: source.packagingCostPerUnit,
        deliveryCostPerUnit: source.deliveryCostPerUnit,
        otherCostPerUnit: source.otherCostPerUnit,
        baseSalePriceEur: source.baseSalePriceEur,
        germanPriceEur: source.germanPriceEur,
        soloAllowed: source.soloAllowed,
        defaultSupplierId: source.defaultSupplierId,
      } as any,
    });

    if (source.components.length > 0) {
      await this.prisma.tenant.assemblyComponent.createMany({
        data: source.components.map((c) => ({
          assemblyId: copy.id,
          componentType: c.componentType,
          productId: c.productId,
          subAssemblyId: c.subAssemblyId,
          warehouseId: c.warehouseId,
          qtyPerUnit: c.qtyPerUnit,
        })) as any,
      });

      const version = await this.prisma.tenant.assemblyVersion.create({
        data: { assemblyId: copy.id, versionNumber: 1, createdById: user.userId } as any,
      });
      await this.prisma.tenant.assemblyVersionComponent.createMany({
        data: source.components.map((c) => ({
          assemblyVersionId: version.id,
          componentType: c.componentType,
          productId: c.productId,
          subAssemblyId: c.subAssemblyId,
          warehouseId: c.warehouseId,
          qtyPerUnit: c.qtyPerUnit,
        })) as any,
      });
    }

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'assembly.duplicated',
      entityType: 'Assembly',
      entityId: copy.id,
      after: { sourceAssemblyId: sourceId, componentCount: source.components.length },
    });

    return this.findOne(user, copy.id);
  }

  // ============================================================
  // Suppliers (multi-supplier link, each with its own optional price)
  // ============================================================

  async getSuppliers(user: RequestUser, assemblyId: string) {
    await this.findOne(user, assemblyId);
    const rows = await this.prisma.tenant.assemblySupplier.findMany({
      where: { assemblyId },
      include: { supplier: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      supplierId: r.supplierId,
      supplierName: r.supplier.name,
      price: r.price,
      isDefault: r.isDefault,
    }));
  }

  async setSuppliers(user: RequestUser, assemblyId: string, dto: SetAssemblySuppliersDto) {
    await this.findOne(user, assemblyId);
    await this.prisma.tenant.assemblySupplier.deleteMany({ where: { assemblyId } });
    if (dto.suppliers.length > 0) {
      await this.prisma.tenant.assemblySupplier.createMany({
        data: dto.suppliers.map((line) => ({
          assemblyId,
          supplierId: line.supplierId,
          price: line.price,
          isDefault: line.isDefault ?? false,
        })) as any,
      });
    }
    return this.getSuppliers(user, assemblyId);
  }

  // ============================================================
  // BOM lines + versioning
  // ============================================================

  async getComponents(user: RequestUser, assemblyId: string) {
    await this.findOne(user, assemblyId);
    return this.prisma.tenant.assemblyComponent.findMany({ where: { assemblyId }, orderBy: { id: 'asc' } });
  }

  /**
   * Replaces the full BOM line list and writes a new immutable
   * AssemblyVersion snapshot — mirrors the legacy `saveAssembly` /
   * `saveAssemblyVersionSnapshot_` pair (Phase 1 §3.3): every save is a new
   * version, never an edit of a past one, so `ProductionOrder.assemblyVersionId`
   * can lock onto a specific point in time (Phase 1 §6.4). Runs as plain
   * sequential writes against `this.prisma.tenant`, not a nested
   * `$transaction` — the whole HTTP request is already one transaction via
   * `TenantScopeInterceptor` (same convention as InventorySessionsService.complete).
   */
  async setComponents(user: RequestUser, assemblyId: string, dto: SetAssemblyComponentsDto) {
    await this.findOne(user, assemblyId);
    this.validateComponentLines(dto.components);
    await this.assertNoCycle(assemblyId, dto.components);

    await this.prisma.tenant.assemblyComponent.deleteMany({ where: { assemblyId } });
    if (dto.components.length > 0) {
      await this.prisma.tenant.assemblyComponent.createMany({
        data: dto.components.map((line) => ({
          assemblyId,
          componentType: line.componentType as unknown as ComponentType,
          productId: line.componentType === 'PRODUCT' ? line.productId : null,
          subAssemblyId: line.componentType === 'ASSEMBLY' ? line.subAssemblyId : null,
          warehouseId: line.warehouseId ?? null,
          qtyPerUnit: line.qtyPerUnit,
        })) as any,
      });
    }

    const lastVersion = await this.prisma.tenant.assemblyVersion.findFirst({
      where: { assemblyId },
      orderBy: { versionNumber: 'desc' },
    });
    const versionNumber = (lastVersion?.versionNumber ?? 0) + 1;

    const version = await this.prisma.tenant.assemblyVersion.create({
      data: { assemblyId, versionNumber, createdById: user.userId } as any,
    });

    if (dto.components.length > 0) {
      await this.prisma.tenant.assemblyVersionComponent.createMany({
        data: dto.components.map((line) => ({
          assemblyVersionId: version.id,
          componentType: line.componentType as unknown as ComponentType,
          productId: line.componentType === 'PRODUCT' ? line.productId : null,
          subAssemblyId: line.componentType === 'ASSEMBLY' ? line.subAssemblyId : null,
          warehouseId: line.warehouseId ?? null,
          qtyPerUnit: line.qtyPerUnit,
        })) as any,
      });
    }

    const components = await this.getComponents(user, assemblyId);

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'assembly.bom_saved',
      entityType: 'Assembly',
      entityId: assemblyId,
      after: { versionNumber, componentCount: dto.components.length },
    });

    return { version, components };
  }

  async getVersions(user: RequestUser, assemblyId: string) {
    await this.findOne(user, assemblyId);
    return this.prisma.tenant.assemblyVersion.findMany({
      where: { assemblyId },
      orderBy: { versionNumber: 'desc' },
    });
  }

  async getVersion(user: RequestUser, assemblyId: string, versionId: string) {
    await this.findOne(user, assemblyId);
    const version = await this.prisma.tenant.assemblyVersion.findFirst({
      where: { id: versionId, assemblyId },
      include: { components: true },
    });
    if (!version) throw new CodedNotFoundException('BOM_VERSION_NOT_FOUND', 'Assembly version not found.');
    return version;
  }

  private validateComponentLines(lines: AssemblyComponentLineDto[]) {
    for (const line of lines) {
      if (line.componentType === 'PRODUCT') {
        if (!line.productId) {
          throw new CodedBadRequestException('BOM_PRODUCT_ID_REQUIRED', 'productId is required when componentType is PRODUCT.');
        }
        if (line.subAssemblyId) {
          throw new CodedBadRequestException('BOM_SUBASSEMBLY_ID_MUST_BE_OMITTED', 'subAssemblyId must be omitted when componentType is PRODUCT.');
        }
      } else if (line.componentType === 'ASSEMBLY') {
        if (!line.subAssemblyId) {
          throw new CodedBadRequestException('BOM_SUBASSEMBLY_ID_REQUIRED', 'subAssemblyId is required when componentType is ASSEMBLY.');
        }
        if (line.productId) {
          throw new CodedBadRequestException('BOM_PRODUCT_ID_MUST_BE_OMITTED', 'productId must be omitted when componentType is ASSEMBLY.');
        }
      }
    }
  }

  /**
   * Rejects a save that would introduce a circular BOM (A contains B
   * contains A), checked against the *existing, already-saved* component
   * tree of every proposed sub-assembly. This is a deliberate improvement
   * over the legacy behavior, which only guarded against infinite
   * recursion at read-time via a visited set and otherwise silently
   * truncated a genuine cycle rather than flagging it as a data error
   * (Phase 1 §10.5).
   */
  private async assertNoCycle(assemblyId: string, lines: AssemblyComponentLineDto[]) {
    const subAssemblyIds = lines
      .filter((line) => line.componentType === 'ASSEMBLY' && line.subAssemblyId)
      .map((line) => line.subAssemblyId as string);

    for (const subId of subAssemblyIds) {
      if (subId === assemblyId) {
        throw new CodedConflictException('BOM_SELF_REFERENCE', 'An assembly cannot contain itself as a component.');
      }
      const reachable = await this.collectReachableAssemblyIds(subId, new Set([subId]));
      if (reachable.has(assemblyId)) {
        throw new CodedConflictException(
          'BOM_CIRCULAR_REFERENCE',
          `Adding "${subId}" as a component would create a circular BOM: it already contains this assembly, directly or indirectly.`,
        );
      }
    }
  }

  /** Full-expansion reachability set from `startAssemblyId`, over already-persisted AssemblyComponent rows only. */
  private async collectReachableAssemblyIds(startAssemblyId: string, visited: Set<string>): Promise<Set<string>> {
    const components = await this.prisma.tenant.assemblyComponent.findMany({
      where: { assemblyId: startAssemblyId, componentType: 'ASSEMBLY' },
    });
    for (const component of components) {
      if (component.subAssemblyId && !visited.has(component.subAssemblyId)) {
        visited.add(component.subAssemblyId);
        await this.collectReachableAssemblyIds(component.subAssemblyId, visited);
      }
    }
    return visited;
  }

  // ============================================================
  // Cost calculation (calcAssemblyCost_ port)
  // ============================================================

  async calculateCost(user: RequestUser, assemblyId: string): Promise<AssemblyCostResult> {
    // No separate findOne() existence check here (unlike checkAvailability,
    // below) — calcAssemblyCostRecursive's own `assembly.findUnique` already
    // throws NotFoundException if the top-level assemblyId doesn't exist,
    // so an extra findOne() call first would just be a redundant fetch of
    // the same row (found and fixed: this second read used to silently
    // shadow the first one under jest mocking with per-call
    // mockResolvedValueOnce sequencing, since the redundant call shifts
    // every subsequent recursive fetch's mocked response by one — a real,
    // if usually harmless against an actual database, wasted round trip).
    return this.calcAssemblyCostRecursive(user, assemblyId, new Set());
  }

  /**
   * `visited` tracks the current *ancestor path*, not "everywhere seen" —
   * entries are removed on the way back out of the recursion (line at the
   * bottom of this method), so a legitimate diamond dependency (two
   * different branches both using sub-assembly D) is not mistaken for a
   * cycle; only a genuine ancestor-reappearing-as-its-own-descendant is.
   */
  private async calcAssemblyCostRecursive(
    user: RequestUser,
    assemblyId: string,
    visited: Set<string>,
  ): Promise<AssemblyCostResult> {
    if (visited.has(assemblyId)) {
      throw new CodedConflictException(
        'BOM_CIRCULAR_COST_CALC',
        `Circular BOM detected while calculating cost (assembly ${assemblyId} references itself, directly or indirectly). ` +
          'This should be unreachable for BOMs saved after cycle detection was added — see setComponents.',
      );
    }
    visited.add(assemblyId);

    const assembly = await this.prisma.tenant.assembly.findUnique({
      where: { id: assemblyId },
      include: { components: true },
    });
    if (!assembly) {
      throw new CodedNotFoundException('PRODUCTION_ASSEMBLY_NOT_FOUND', `Assembly ${assemblyId} not found.`);
    }

    // `sellPriceEur` is the ONE price every calculation in this app is
    // pinned to (explicit business rule, not a technical default) —
    // localPriceExclVat/localPriceInclVat/germanPriceExclVat/
    // germanPriceInclVat are informational reference fields only (still
    // stored, still shown/editable on the product and in import/export),
    // never multiplied into a cost/value total anywhere. This used to track
    // a separate cost basis per those two supplier prices instead
    // (localCostPerUnit/germanCostPerUnit) — real behavior change, not a
    // bug fix: this is a deliberate switch to a single sellPriceEur-based
    // cost, matching the same rule applied to production materials cost
    // (production-orders.service.ts) and the valuation report
    // (reports.service.ts).
    const ownCost =
      Number(assembly.laborCostPerUnit) +
      Number(assembly.packagingCostPerUnit) +
      Number(assembly.deliveryCostPerUnit) +
      Number(assembly.otherCostPerUnit);

    let costPerUnit = ownCost;
    const breakdown: CostBreakdownLine[] = [];
    // Multi-currency module (2026-10-29) — a component's own price/cost is
    // computed in ITS OWN currency (Product.currency / the sub-assembly's
    // own Assembly.currency), which may differ from this assembly's. Always
    // converted "as of today" before folding into `costPerUnit`, matching
    // this whole method's own "compute live, never store" convention —
    // there's no persisted cost to freeze a historical rate against.
    const today = new Date();

    for (const line of assembly.components) {
      const qtyPerUnit = Number(line.qtyPerUnit);

      if (line.componentType === 'PRODUCT' && line.productId) {
        const product = await this.prisma.tenant.product.findUnique({ where: { id: line.productId } });
        if (!product) throw new CodedNotFoundException('BOM_COMPONENT_PRODUCT_NOT_FOUND', `Component product ${line.productId} not found.`);
        const rawUnitCost = Number(product.sellPriceEur ?? 0);
        const unitCost = await this.exchangeRatesService.convert(rawUnitCost, product.currency ?? 'EUR', assembly.currency ?? 'EUR', user.companyId, today);
        costPerUnit += unitCost * qtyPerUnit;
        breakdown.push({
          componentType: 'PRODUCT',
          productId: line.productId,
          qtyPerUnit,
          unitCost,
          lineCost: unitCost * qtyPerUnit,
        });
      } else if (line.componentType === 'ASSEMBLY' && line.subAssemblyId) {
        const sub = await this.calcAssemblyCostRecursive(user, line.subAssemblyId, visited);
        const unitCost = await this.exchangeRatesService.convert(sub.costPerUnit, sub.currency, assembly.currency ?? 'EUR', user.companyId, today);
        costPerUnit += unitCost * qtyPerUnit;
        breakdown.push({
          componentType: 'ASSEMBLY',
          subAssemblyId: line.subAssemblyId,
          qtyPerUnit,
          unitCost,
          lineCost: unitCost * qtyPerUnit,
        });
      }
    }

    visited.delete(assemblyId);
    return { assemblyId, costPerUnit, currency: assembly.currency ?? 'EUR', breakdown };
  }

  // ============================================================
  // Weight calculation — mirrors the cost calculation above exactly
  // (same recursive structure, same ancestor-path cycle guard), just
  // summing Product.weightPerUnitKg × qtyPerUnit instead of sellPriceEur.
  // ============================================================

  async calculateWeight(user: RequestUser, assemblyId: string): Promise<AssemblyWeightResult> {
    return this.calcAssemblyWeightRecursive(assemblyId, new Set());
  }

  private async calcAssemblyWeightRecursive(
    assemblyId: string,
    visited: Set<string>,
  ): Promise<AssemblyWeightResult> {
    if (visited.has(assemblyId)) {
      throw new CodedConflictException(
        'BOM_CIRCULAR_WEIGHT_CALC',
        `Circular BOM detected while calculating weight (assembly ${assemblyId} references itself, directly or indirectly). ` +
          'This should be unreachable for BOMs saved after cycle detection was added — see setComponents.',
      );
    }
    visited.add(assemblyId);

    const assembly = await this.prisma.tenant.assembly.findUnique({
      where: { id: assemblyId },
      include: { components: true },
    });
    if (!assembly) {
      throw new CodedNotFoundException('PRODUCTION_ASSEMBLY_NOT_FOUND', `Assembly ${assemblyId} not found.`);
    }

    let weightPerUnit = 0;
    let complete = true;
    const breakdown: WeightBreakdownLine[] = [];

    for (const line of assembly.components) {
      const qtyPerUnit = Number(line.qtyPerUnit);

      if (line.componentType === 'PRODUCT' && line.productId) {
        const product = await this.prisma.tenant.product.findUnique({ where: { id: line.productId } });
        if (!product) throw new CodedNotFoundException('BOM_COMPONENT_PRODUCT_NOT_FOUND', `Component product ${line.productId} not found.`);
        const unitWeightKg = product.weightPerUnitKg != null ? Number(product.weightPerUnitKg) : null;
        const lineWeightKg = (unitWeightKg ?? 0) * qtyPerUnit;
        weightPerUnit += lineWeightKg;
        if (unitWeightKg == null) complete = false;
        breakdown.push({
          componentType: 'PRODUCT',
          productId: line.productId,
          qtyPerUnit,
          unitWeightKg,
          lineWeightKg,
          complete: unitWeightKg != null,
        });
      } else if (line.componentType === 'ASSEMBLY' && line.subAssemblyId) {
        const sub = await this.calcAssemblyWeightRecursive(line.subAssemblyId, visited);
        const lineWeightKg = sub.weightPerUnitKg * qtyPerUnit;
        weightPerUnit += lineWeightKg;
        if (!sub.complete) complete = false;
        breakdown.push({
          componentType: 'ASSEMBLY',
          subAssemblyId: line.subAssemblyId,
          qtyPerUnit,
          unitWeightKg: sub.weightPerUnitKg,
          lineWeightKg,
          complete: sub.complete,
        });
      }
    }

    visited.delete(assemblyId);
    return { assemblyId, weightPerUnitKg: weightPerUnit, complete, breakdown };
  }

  // ============================================================
  // German-price-from-BOM calculation (2026-10-15 user request:
  // "додай можливість рахувати у специфікаціях ціна виробу в німеччмні з
  // склад бум товарів в яких вказана Ціна (DE, з ПДВ) або підвиробів в
  // яких вказана Ціна виробу в Німеччині, €") — unlike the cost/weight
  // calculations above, this is deliberately ONE LEVEL DEEP, not a full
  // recursive rollup: for an ASSEMBLY-type BOM line, it reads the
  // sub-assembly's own already-curated germanPriceEur value as-is, rather
  // than recursing into THAT sub-assembly's own components. Both
  // germanPriceInclVat and germanPriceEur are manually-entered, human-
  // verified benchmark prices (real German retail/market prices someone
  // looked up), not cost-basis numbers — re-deriving a sub-assembly's
  // figure from its own components would silently discard that human
  // verification and compound estimation error at every level, which cost/
  // weight don't risk (sellPriceEur/weightPerUnitKg are themselves already
  // leaf-level Product facts, not independently-curated judgments at every
  // tier). So: sum of (this assembly's direct components' own German
  // price × qtyPerUnit) only — no `visited` cycle guard needed either,
  // since there is no recursion into sub-assemblies to begin with.
  // ============================================================

  async calculateGermanPriceFromBom(user: RequestUser, assemblyId: string): Promise<AssemblyGermanPriceResult> {
    const assembly = await this.prisma.tenant.assembly.findUnique({
      where: { id: assemblyId },
      include: { components: true },
    });
    if (!assembly) {
      throw new CodedNotFoundException('PRODUCTION_ASSEMBLY_NOT_FOUND', `Assembly ${assemblyId} not found.`);
    }

    let germanPricePerUnit = 0;
    let complete = true;
    const breakdown: GermanPriceBreakdownLine[] = [];

    for (const line of assembly.components) {
      const qtyPerUnit = Number(line.qtyPerUnit);

      if (line.componentType === 'PRODUCT' && line.productId) {
        const product = await this.prisma.tenant.product.findUnique({ where: { id: line.productId } });
        if (!product) throw new CodedNotFoundException('BOM_COMPONENT_PRODUCT_NOT_FOUND', `Component product ${line.productId} not found.`);
        const unitGermanPrice = product.germanPriceInclVat != null ? Number(product.germanPriceInclVat) : null;
        const lineGermanPrice = (unitGermanPrice ?? 0) * qtyPerUnit;
        germanPricePerUnit += lineGermanPrice;
        if (unitGermanPrice == null) complete = false;
        breakdown.push({
          componentType: 'PRODUCT',
          productId: line.productId,
          qtyPerUnit,
          unitGermanPrice,
          lineGermanPrice,
          complete: unitGermanPrice != null,
        });
      } else if (line.componentType === 'ASSEMBLY' && line.subAssemblyId) {
        const sub = await this.prisma.tenant.assembly.findUnique({ where: { id: line.subAssemblyId } });
        if (!sub) throw new CodedNotFoundException('BOM_COMPONENT_ASSEMBLY_NOT_FOUND', `Component sub-assembly ${line.subAssemblyId} not found.`);
        const unitGermanPrice = sub.germanPriceEur != null ? Number(sub.germanPriceEur) : null;
        const lineGermanPrice = (unitGermanPrice ?? 0) * qtyPerUnit;
        germanPricePerUnit += lineGermanPrice;
        if (unitGermanPrice == null) complete = false;
        breakdown.push({
          componentType: 'ASSEMBLY',
          subAssemblyId: line.subAssemblyId,
          qtyPerUnit,
          unitGermanPrice,
          lineGermanPrice,
          complete: unitGermanPrice != null,
        });
      }
    }

    return { assemblyId, germanPricePerUnit, complete, breakdown };
  }

  // ============================================================
  // Cost-vs-German-price comparison report (2026-10-17 user request —
  // real worked example: article 279785, 305.93 € cost vs a STALE 314.25 €
  // stored German price, walked line-by-line by hand to find the 7
  // products actually driving the gap plus a stale sub-assembly figure —
  // "додай можливість робити такий звіт у будь якій специфікації").
  //
  // Combines calculateCost's full recursive cost (every ASSEMBLY line
  // recurses all the way down, same as /cost) with the ONE-LEVEL German
  // read calculateGermanPriceFromBom also uses (a PRODUCT line reads
  // germanPriceInclVat, an ASSEMBLY line reads the sub-assembly's own
  // already-curated germanPriceEur verbatim, never recursing into the
  // sub's own components — see that method's own header comment for why).
  // Also flags `isStoredGermanPriceStale`: whether Assembly.germanPriceEur
  // (the saved value the cost/German-price cards actually display) still
  // matches what a fresh one-level calc would produce RIGHT NOW — nothing
  // keeps that stored field in sync automatically (see
  // QuotationVersion.germanPriceMarkupAmount's own schema comment on the
  // same "snapshot, not live" pattern elsewhere in this codebase), so after
  // editing a component's price or a sub-assembly's own German price, the
  // parent's stored figure silently goes stale until someone reapplies the
  // calculator — exactly what happened in the real example above.
  // ============================================================

  async compareCostToGermanPrice(user: RequestUser, assemblyId: string): Promise<AssemblyCostVsGermanPriceResult> {
    const assembly = await this.prisma.tenant.assembly.findUnique({
      where: { id: assemblyId },
      include: { components: true },
    });
    if (!assembly) {
      throw new CodedNotFoundException('PRODUCTION_ASSEMBLY_NOT_FOUND', `Assembly ${assemblyId} not found.`);
    }

    const ownLaborCost = Number(assembly.laborCostPerUnit);
    const ownPackagingCost = Number(assembly.packagingCostPerUnit);
    const ownDeliveryCost = Number(assembly.deliveryCostPerUnit);
    const ownOtherCost = Number(assembly.otherCostPerUnit);

    let costPerUnit = ownLaborCost + ownPackagingCost + ownDeliveryCost + ownOtherCost;
    let freshGermanPricePerUnit = 0;
    let freshGermanPriceComplete = true;
    const lines: CostVsGermanPriceLine[] = [];

    for (const line of assembly.components) {
      const qtyPerUnit = Number(line.qtyPerUnit);

      if (line.componentType === 'PRODUCT' && line.productId) {
        const product = await this.prisma.tenant.product.findUnique({ where: { id: line.productId } });
        if (!product) throw new CodedNotFoundException('BOM_COMPONENT_PRODUCT_NOT_FOUND', `Component product ${line.productId} not found.`);
        const unitCost = Number(product.sellPriceEur ?? 0);
        const unitGermanPrice = product.germanPriceInclVat != null ? Number(product.germanPriceInclVat) : null;
        const lineCost = round2(unitCost * qtyPerUnit);
        const lineGermanPrice = round2((unitGermanPrice ?? 0) * qtyPerUnit);
        costPerUnit += lineCost;
        freshGermanPricePerUnit += lineGermanPrice;
        if (unitGermanPrice == null) freshGermanPriceComplete = false;
        lines.push({
          componentType: 'PRODUCT',
          productId: line.productId,
          qtyPerUnit,
          unitCost,
          unitGermanPrice,
          lineCost,
          lineGermanPrice,
          lineDelta: round2(lineGermanPrice - lineCost),
          germanPriceMissing: unitGermanPrice == null,
        });
      } else if (line.componentType === 'ASSEMBLY' && line.subAssemblyId) {
        const subAssembly = await this.prisma.tenant.assembly.findUnique({ where: { id: line.subAssemblyId } });
        if (!subAssembly) throw new CodedNotFoundException('BOM_COMPONENT_ASSEMBLY_NOT_FOUND', `Component sub-assembly ${line.subAssemblyId} not found.`);
        // Full recursive cost (calculateCost already walks arbitrarily deep,
        // cycle-protected on its own) — but the German side stays ONE level,
        // reading the sub-assembly's own stored germanPriceEur verbatim, same
        // as calculateGermanPriceFromBom. Mixing a deep cost with a shallow
        // German read is deliberate, not an oversight — see that method's own
        // comment on why a sub-assembly's human-curated German price is never
        // re-derived from its own components.
        const subCost = await this.calculateCost(user, line.subAssemblyId);
        const unitCost = subCost.costPerUnit;
        const unitGermanPrice = subAssembly.germanPriceEur != null ? Number(subAssembly.germanPriceEur) : null;
        const lineCost = round2(unitCost * qtyPerUnit);
        const lineGermanPrice = round2((unitGermanPrice ?? 0) * qtyPerUnit);
        costPerUnit += lineCost;
        freshGermanPricePerUnit += lineGermanPrice;
        if (unitGermanPrice == null) freshGermanPriceComplete = false;
        lines.push({
          componentType: 'ASSEMBLY',
          subAssemblyId: line.subAssemblyId,
          qtyPerUnit,
          unitCost,
          unitGermanPrice,
          lineCost,
          lineGermanPrice,
          lineDelta: round2(lineGermanPrice - lineCost),
          germanPriceMissing: unitGermanPrice == null,
        });
      }
    }

    const storedGermanPriceEur = assembly.germanPriceEur != null ? Number(assembly.germanPriceEur) : null;
    const roundedFreshGermanPrice = round2(freshGermanPricePerUnit);
    // A couple of cents of rounding drift across dozens of lines is normal
    // (every lineCost/lineGermanPrice above is independently rounded) — only
    // flag genuine staleness, not rounding noise.
    const isStoredGermanPriceStale = storedGermanPriceEur !== null && Math.abs(storedGermanPriceEur - roundedFreshGermanPrice) >= 0.01;

    return {
      assemblyId,
      costPerUnit: round2(costPerUnit),
      ownLaborCost,
      ownPackagingCost,
      ownDeliveryCost,
      ownOtherCost,
      storedGermanPriceEur,
      freshGermanPricePerUnit: roundedFreshGermanPrice,
      freshGermanPriceComplete,
      isStoredGermanPriceStale,
      lines,
    };
  }

  // ============================================================
  // Availability + produce (Assemblies.produceAssembly port)
  // ============================================================

  async checkAvailability(user: RequestUser, assemblyId: string, qty: number): Promise<AvailabilityResult> {
    await this.findOne(user, assemblyId);

    const requirements = new Map<string, number>();
    await this.flattenRequirements(assemblyId, qty, requirements, new Set());

    const shortages: AvailabilityResult['shortages'] = [];
    for (const [productId, needed] of requirements) {
      const product = await this.prisma.tenant.product.findUnique({ where: { id: productId } });
      const available = Number(product?.qty ?? 0);
      if (available < needed) {
        shortages.push({ productId, needed, available, shortage: needed - available });
      }
    }

    return {
      assemblyId,
      qty,
      sufficient: shortages.length === 0,
      requirements: Array.from(requirements.entries()).map(([productId, needed]) => ({ productId, needed })),
      shortages,
    };
  }

  /**
   * Flattens the BOM recursively down to real Product leaves. Neither
   * Assembly nor a purchased sub-assembly (`defaultSupplierId` set) carries
   * its own stock in this schema, so availability/consumption must always
   * expand all the way down — `defaultSupplierId` is deliberately not
   * consulted here (see class header comment).
   */
  private async flattenRequirements(
    assemblyId: string,
    qtyOfAssembly: number,
    requirements: Map<string, number>,
    visited: Set<string>,
  ): Promise<void> {
    if (visited.has(assemblyId)) {
      throw new CodedConflictException('BOM_CIRCULAR_EXPAND', `Circular BOM detected while expanding assembly ${assemblyId}.`);
    }
    visited.add(assemblyId);

    const components = await this.prisma.tenant.assemblyComponent.findMany({ where: { assemblyId } });
    for (const line of components) {
      const neededQty = qtyOfAssembly * Number(line.qtyPerUnit);
      if (line.componentType === 'PRODUCT' && line.productId) {
        requirements.set(line.productId, (requirements.get(line.productId) ?? 0) + neededQty);
      } else if (line.componentType === 'ASSEMBLY' && line.subAssemblyId) {
        await this.flattenRequirements(line.subAssemblyId, neededQty, requirements, visited);
      }
    }

    visited.delete(assemblyId);
  }

  // ============================================================
  // Sub-assembly batch planning (2026-08-25 user request)
  // ============================================================

  /**
   * Every DISTINCT sub-assembly needed to build `qty` units of `assemblyId`,
   * at ANY BOM depth (a sub-assembly's own sub-assemblies included), with
   * quantities aggregated across every branch it appears in — the "what
   * needs its own production batch, and how much of it is already on the
   * shelf" list shown when adding a sales-order line. Deliberately always
   * recurses through every ASSEMBLY-type line unconditionally, unlike
   * CustomerOrderShortageService's buy-line rule (which stops recursing
   * once a sub-assembly has a supplier link) — the question here is "what
   * needs a production batch," not "what needs a purchase order," so a
   * supplier link is irrelevant to it.
   */
  async listSubAssembliesNeeded(user: RequestUser, assemblyId: string, qty: number): Promise<SubAssemblyNeed[]> {
    await this.findOne(user, assemblyId);

    const needs = new Map<string, number>();
    await this.flattenSubAssemblyNeeds(assemblyId, qty, needs, new Set());

    const results: SubAssemblyNeed[] = [];
    for (const [subAssemblyId, qtyNeeded] of needs) {
      const sub = await this.prisma.tenant.assembly.findUnique({ where: { id: subAssemblyId } });
      const qtyInStock = await this.prisma.tenant.finishedGood.count({ where: { assemblyId: subAssemblyId, status: 'IN_STOCK' } });
      const reservedBreakdown = await this.subAssemblyReservationService.getBreakdown(user, subAssemblyId);
      const reservedByOthers = reservedBreakdown.reduce((sum, r) => sum + r.qty, 0);
      results.push({ assemblyId: subAssemblyId, name: sub?.name ?? subAssemblyId, article: sub?.article ?? null, qtyNeeded, qtyInStock, reservedByOthers, reservedBreakdown });
    }
    return results;
  }

  /** Same ancestor-path cycle-guard convention as flattenRequirements/calcAssemblyCostRecursive above. */
  private async flattenSubAssemblyNeeds(
    assemblyId: string,
    qtyOfAssembly: number,
    needs: Map<string, number>,
    visited: Set<string>,
  ): Promise<void> {
    if (visited.has(assemblyId)) {
      throw new CodedConflictException('BOM_CIRCULAR_EXPAND', `Circular BOM detected while expanding assembly ${assemblyId}.`);
    }
    visited.add(assemblyId);

    const components = await this.prisma.tenant.assemblyComponent.findMany({ where: { assemblyId } });
    for (const line of components) {
      if (line.componentType === 'ASSEMBLY' && line.subAssemblyId) {
        const neededQty = qtyOfAssembly * Number(line.qtyPerUnit);
        needs.set(line.subAssemblyId, (needs.get(line.subAssemblyId) ?? 0) + neededQty);
        await this.flattenSubAssemblyNeeds(line.subAssemblyId, neededQty, needs, visited);
      }
    }

    visited.delete(assemblyId);
  }

  /**
   * "Хід виробництва" (2026-08-25 user request): the full BOM tree as an
   * actual parent -> child chain (unlike listSubAssembliesNeeded's flat,
   * cross-branch-aggregated map above) — every node carries its own
   * IN_STOCK count and a `done` flag, so a sales order's production plan
   * can be rendered as "this виріб is made of these підвироби, which are
   * each made of..." with what's already on the shelf lit up green and
   * what still needs producing left grey. Same always-recurse rule as
   * listSubAssembliesNeeded (not CustomerOrderShortageService's
   * supplier-link-gated one) — this is about physical stock readiness,
   * not purchasing.
   */
  async getProductionTree(user: RequestUser, assemblyId: string, qty: number, customerOrderId: string): Promise<ProductionTreeNode> {
    await this.findOne(user, assemblyId);
    // 2026-09-17 user report ("коли ми використовували [куплені готовими]
    // в інших виробах вони списались з складу і чомусь статус... змінився
    // що потрібно виготовити"): every ProductionOrder batch that belongs to
    // THIS customer order (via customerOrderItemId, or subAssemblyForItemId
    // for a sub-assembly batch — same dual-field resolution
    // ProductionOrdersService#resolveCustomerOrderId uses), computed once
    // up front and threaded through the whole recursion below — see
    // `done`'s own doc comment for why this is needed.
    const orderItemIds = (await this.prisma.tenant.customerOrderItem.findMany({ where: { customerOrderId }, select: { id: true } })).map(
      (i) => i.id,
    );
    const consumedIntoProductionOrderIds = orderItemIds.length
      ? (
          await this.prisma.tenant.productionOrder.findMany({
            where: { OR: [{ customerOrderItemId: { in: orderItemIds } }, { subAssemblyForItemId: { in: orderItemIds } }] },
            select: { id: true },
          })
        ).map((p) => p.id)
      : [];
    return this.buildProductionTree(user, customerOrderId, consumedIntoProductionOrderIds, assemblyId, qty, new Set());
  }

  private async buildProductionTree(
    user: RequestUser,
    customerOrderId: string,
    consumedIntoProductionOrderIds: string[],
    assemblyId: string,
    qty: number,
    visited: Set<string>,
  ): Promise<ProductionTreeNode> {
    if (visited.has(assemblyId)) {
      throw new CodedConflictException('BOM_CIRCULAR_EXPAND', `Circular BOM detected while expanding assembly ${assemblyId}.`);
    }
    visited.add(assemblyId);

    const [
      assembly,
      qtyInStock,
      qtyConsumedForThisOrder,
      qtyClaimedFromStock,
      qtyPurchasedInStock,
      qtyPurchasedConsumedForThisOrder,
      components,
    ] = await Promise.all([
      this.prisma.tenant.assembly.findUnique({ where: { id: assemblyId } }),
      // `productionOrderId: null OR confirmedByExecutionId: { not: null }` —
      // FinishedGood.confirmedByExecutionId's own schema comment spells out
      // this exact rule: a PURCHASED unit (no productionOrderId at all, e.g.
      // claimed "Зі складу" at order creation) has no labor to confirm and
      // counts as available immediately; a MANUFACTURED unit
      // (productionOrderId set) goes IN_STOCK the moment its execution
      // finishes but stays unconfirmed (payroll not yet closed) until
      // stampConfirmedFinishedGoods stamps it. An EARLIER version of this
      // fix (2026-08-31, "чому пише що готово якщо вони у виробництві і
      // зарплату ще не закрили по них") required confirmedByExecutionId
      // unconditionally — which fixed manufactured units but wrongly hid
      // genuinely-available PURCHASED stock too, since confirmedByExecutionId
      // never gets set for those (2026-09-01 fix — "чому в ході виробництва
      // зникли вироби з позначкою готово які... забили що візьмемо куплені
      // зі склада"). Same OR shape `applyFinishedGoodScope`'s READY scope
      // uses for Склад. Drives `done` only — see laborFundEstimate's own doc
      // comment for why it does NOT also drive the labor estimate.
      this.prisma.tenant.finishedGood.count({
        where: { assemblyId, status: 'IN_STOCK', OR: [{ productionOrderId: null }, { confirmedByExecutionId: { not: null } }] },
      }),
      // See `done`'s own doc comment — units of THIS node's own assembly
      // that were already legitimately consumed as a component of another
      // node's batch, in service of THIS same customer order.
      consumedIntoProductionOrderIds.length
        ? this.prisma.tenant.finishedGood.count({
            where: { assemblyId, status: 'CONSUMED', consumedInProductionOrderId: { in: consumedIntoProductionOrderIds } },
          })
        : Promise.resolve(0),
      this.subAssemblyReservationService.getClaimedIncludingConsumedForOrder(user, customerOrderId, assemblyId),
      // 2026-09-17 fix (real order #441639, articles 264112/264193 — bought
      // ready-made through ordinary procurement/FIFO, NEVER through the
      // "Підвироби" dialog at all, so `qtyClaimedFromStock` above stayed 0
      // for them even though nothing was ever going to be manufactured): a
      // PURCHASED unit (`productionOrderId: null`, same rule FinishedGood's
      // own schema comment documents) has no labor to charge regardless of
      // whether anyone ever formally "claimed" it through that dialog —
      // live purchased stock still sitting on the shelf right now...
      this.prisma.tenant.finishedGood.count({ where: { assemblyId, status: 'IN_STOCK', productionOrderId: null } }),
      // ...plus purchased stock already consumed into another node's batch
      // FOR THIS ORDER specifically (same scoping as qtyConsumedForThisOrder
      // above, just narrowed to productionOrderId: null so a MANUFACTURED
      // sub-assembly that later gets consumed still charges its real labor
      // — see laborFundEstimate's own doc comment for the full incident).
      consumedIntoProductionOrderIds.length
        ? this.prisma.tenant.finishedGood.count({
            where: { assemblyId, status: 'CONSUMED', productionOrderId: null, consumedInProductionOrderId: { in: consumedIntoProductionOrderIds } },
          })
        : Promise.resolve(0),
      this.prisma.tenant.assemblyComponent.findMany({ where: { assemblyId, componentType: 'ASSEMBLY' } }),
    ]);
    if (!assembly) throw new CodedNotFoundException('PRODUCTION_ASSEMBLY_NOT_FOUND', `Assembly ${assemblyId} not found.`);

    const children: ProductionTreeNode[] = [];
    for (const line of components) {
      if (!line.subAssemblyId) continue;
      children.push(
        await this.buildProductionTree(
          user,
          customerOrderId,
          consumedIntoProductionOrderIds,
          line.subAssemblyId,
          qty * Number(line.qtyPerUnit),
          visited,
        ),
      );
    }

    visited.delete(assemblyId);

    return {
      assemblyId,
      name: assembly.name,
      article: assembly.article,
      qtyNeeded: qty,
      qtyInStock,
      // 2026-09-17 fix: `qtyInStock` alone used to decide `done` — correct
      // for a node still sitting on the shelf, but wrong once it's already
      // been pulled into a batch FOR THIS ORDER (ProductionOrdersService's
      // FIFO consumption at start() marks those units CONSUMED, which drops
      // them out of the live IN_STOCK count entirely). That consumption
      // already fulfilled this node's own requirement — e.g. a sub-assembly
      // bought ready-made and claimed "Зі складу", then used as a component
      // of another виріб in the same order — so it must not flip back to
      // "потрібно виготовити" just because the physical units moved from
      // "on the shelf" to "built into the parent". `qtyConsumedForThisOrder`
      // is scoped to consumption tied to THIS customer order's own batches
      // only (see getProductionTree), never another order's.
      done: qtyInStock + qtyConsumedForThisOrder >= Math.ceil(qty),
      laborFundEstimate:
        Number(assembly.laborCostPerUnit) *
        Math.max(qty - qtyClaimedFromStock - qtyPurchasedInStock - qtyPurchasedConsumedForThisOrder, 0),
      children,
    };
  }

  /**
   * The reservation-free "Дати в роботу" direct-produce path
   * (Assemblies.produceAssembly, Phase 1 §6.1) — immediately checks
   * physical availability and, if sufficient, lists-consumes on the spot.
   * Deliberately does NOT create FinishedGoods rows, does not go through
   * the stage tracker, and is not linked to a customer order — that is the
   * full ProductionOrder lifecycle (Module 6), a distinct code path that
   * must be preserved alongside this one, not collapsed into it.
   */
  async produce(user: RequestUser, assemblyId: string, dto: ProduceAssemblyDto) {
    const assembly = await this.findOne(user, assemblyId);

    const availability = await this.checkAvailability(user, assemblyId, dto.qty);
    if (!availability.sufficient) {
      throw new CodedBadRequestException('BOM_INSUFFICIENT_STOCK_TO_PRODUCE', 'Insufficient stock to produce this quantity.', {
        shortages: availability.shortages,
      });
    }

    const warehouseId = dto.warehouseId ?? (await this.resolveDefaultWarehouseId());

    const movements = [];
    for (const requirement of availability.requirements) {
      const movement = await this.stockService.applyMovement(user, {
        productId: requirement.productId,
        warehouseId,
        type: 'ASSEMBLY_CONSUMPTION',
        qtyDelta: -requirement.needed,
        comment: dto.comment ?? `Produced ${dto.qty} × "${assembly.name}"`,
        sourceType: 'Assembly',
        sourceId: assemblyId,
      });
      movements.push(movement);
    }

    const cost = await this.calculateCost(user, assemblyId);

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'assembly.produced',
      entityType: 'Assembly',
      entityId: assemblyId,
      after: { qty: dto.qty, warehouseId, movementIds: movements.map((m) => m.id) },
    });

    return {
      assemblyId,
      qtyProduced: dto.qty,
      warehouseId,
      consumedMovements: movements,
      costEstimate: {
        costPerUnit: cost.costPerUnit,
        totalCost: cost.costPerUnit * dto.qty,
      },
    };
  }

  private async resolveDefaultWarehouseId(): Promise<string> {
    const warehouse = await this.prisma.tenant.warehouse.findFirst({
      where: { isDefault: true, deletedAt: null },
    });
    if (!warehouse) {
      throw new CodedBadRequestException(
        'PRODUCTION_NO_DEFAULT_WAREHOUSE',
        'No default warehouse configured and none specified — cannot determine where to consume components from.',
      );
    }
    return warehouse.id;
  }
}

/** Money is Decimal(14,2) end to end — round consistently at every arithmetic step rather than letting floating-point drift accumulate (same convention as quotation-pricing.service.ts's own round2). */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
