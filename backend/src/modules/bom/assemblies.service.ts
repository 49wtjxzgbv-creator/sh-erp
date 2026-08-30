import { Injectable } from '@nestjs/common';
import { ComponentType, Prisma } from '@prisma/client';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { CodedBadRequestException, CodedConflictException, CodedNotFoundException } from '../../common/api-exceptions';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StockService } from '../inventory/stock.service';
import { SubAssemblyReservationService, SubAssemblyReservationBreakdownLine } from '../inventory/sub-assembly-reservation.service';
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
  breakdown: CostBreakdownLine[];
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
   * x the SHORTFALL only — max(qtyNeeded - qtyInStock, 0), not the raw
   * qtyNeeded (2026-08-30 fix — "Оцінка по виробах" was showing a full labor
   * estimate for sub-assemblies that already have enough stock on hand,
   * purchased ready-made or otherwise, so nobody will actually be paid to
   * make more of them for this order). Same "own labor only, not recursive"
   * fund every ProductionOrder freezes at start() (production-orders.service.ts's
   * `ownLabor`), same global (not order-reserved) stock count `done` already
   * uses above. Live/never-frozen until that node's own batch actually
   * starts — see CustomerOrdersService#getPayrollFundSummary for the
   * estimated-vs-actual pairing.
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
  ) {}

  // ============================================================
  // CRUD
  // ============================================================

  async create(user: RequestUser, dto: CreateAssemblyDto) {
    const assembly = await this.prisma.tenant.assembly.create({ data: dto as any });
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
    return this.calcAssemblyCostRecursive(assemblyId, new Set());
  }

  /**
   * `visited` tracks the current *ancestor path*, not "everywhere seen" —
   * entries are removed on the way back out of the recursion (line at the
   * bottom of this method), so a legitimate diamond dependency (two
   * different branches both using sub-assembly D) is not mistaken for a
   * cycle; only a genuine ancestor-reappearing-as-its-own-descendant is.
   */
  private async calcAssemblyCostRecursive(
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

    for (const line of assembly.components) {
      const qtyPerUnit = Number(line.qtyPerUnit);

      if (line.componentType === 'PRODUCT' && line.productId) {
        const product = await this.prisma.tenant.product.findUnique({ where: { id: line.productId } });
        if (!product) throw new CodedNotFoundException('BOM_COMPONENT_PRODUCT_NOT_FOUND', `Component product ${line.productId} not found.`);
        const unitCost = Number(product.sellPriceEur ?? 0);
        costPerUnit += unitCost * qtyPerUnit;
        breakdown.push({
          componentType: 'PRODUCT',
          productId: line.productId,
          qtyPerUnit,
          unitCost,
          lineCost: unitCost * qtyPerUnit,
        });
      } else if (line.componentType === 'ASSEMBLY' && line.subAssemblyId) {
        const sub = await this.calcAssemblyCostRecursive(line.subAssemblyId, visited);
        costPerUnit += sub.costPerUnit * qtyPerUnit;
        breakdown.push({
          componentType: 'ASSEMBLY',
          subAssemblyId: line.subAssemblyId,
          qtyPerUnit,
          unitCost: sub.costPerUnit,
          lineCost: sub.costPerUnit * qtyPerUnit,
        });
      }
    }

    visited.delete(assemblyId);
    return { assemblyId, costPerUnit, breakdown };
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
  async getProductionTree(user: RequestUser, assemblyId: string, qty: number): Promise<ProductionTreeNode> {
    await this.findOne(user, assemblyId);
    return this.buildProductionTree(assemblyId, qty, new Set());
  }

  private async buildProductionTree(assemblyId: string, qty: number, visited: Set<string>): Promise<ProductionTreeNode> {
    if (visited.has(assemblyId)) {
      throw new CodedConflictException('BOM_CIRCULAR_EXPAND', `Circular BOM detected while expanding assembly ${assemblyId}.`);
    }
    visited.add(assemblyId);

    const [assembly, qtyInStock, components] = await Promise.all([
      this.prisma.tenant.assembly.findUnique({ where: { id: assemblyId } }),
      this.prisma.tenant.finishedGood.count({ where: { assemblyId, status: 'IN_STOCK' } }),
      this.prisma.tenant.assemblyComponent.findMany({ where: { assemblyId, componentType: 'ASSEMBLY' } }),
    ]);
    if (!assembly) throw new CodedNotFoundException('PRODUCTION_ASSEMBLY_NOT_FOUND', `Assembly ${assemblyId} not found.`);

    const children: ProductionTreeNode[] = [];
    for (const line of components) {
      if (!line.subAssemblyId) continue;
      children.push(await this.buildProductionTree(line.subAssemblyId, qty * Number(line.qtyPerUnit), visited));
    }

    visited.delete(assemblyId);

    return {
      assemblyId,
      name: assembly.name,
      article: assembly.article,
      qtyNeeded: qty,
      qtyInStock,
      done: qtyInStock >= Math.ceil(qty),
      laborFundEstimate: Number(assembly.laborCostPerUnit) * Math.max(qty - qtyInStock, 0),
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
