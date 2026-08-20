import { Injectable } from '@nestjs/common';
import { CodedBadRequestException, CodedConflictException, CodedNotFoundException } from '../../common/api-exceptions';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { StockReservationService } from '../inventory/stock-reservation.service';
import { PurchaseOrdersService } from '../procurement/purchase-orders.service';
import { CreatePurchaseOrdersFromGroupsDto, SaveReservationDecisionsDto } from './dto/shortage-analysis.dto';

export interface SupplierOption {
  supplierId: string;
  supplierName: string;
  price: number | null;
}

export interface ShortageLine {
  kind: 'PRODUCT' | 'ASSEMBLY';
  productId?: string;
  subAssemblyId?: string;
  description: string;
  neededQty: number;
  currentStock: number;
  /**
   * The resolved supplier's price for this line — the single linked
   * supplier's price when there's exactly one, else `Product.sellPriceEur`
   * (which now mirrors the default supplier's price — see
   * ProductsService#setSuppliers) as a last resort for the legacy
   * defaultSupplierId fallback. Null when genuinely unknown. Assemblies
   * have no equivalent field to fall back to, so this stays null there
   * unless a single AssemblySupplier link exists.
   */
  price: number | null;
  /** Present only when the product/assembly has more than one linked supplier (ProductSupplier/AssemblySupplier) — the caller must ask which one to order from rather than guessing. See `ambiguousLines`. */
  supplierOptions?: SupplierOption[];
  /**
   * PRODUCT lines only (2026-08-19 simplification pass — reservations live
   * inline on this page now, not a separate card): `reservedQty` is how
   * much of `neededQty` is already reserved from stock for this order
   * (editable via the "Заброньовано" input, defaults to the maximum that
   * was available at order-creation time); `qtyToPurchase` is the
   * remainder (`neededQty - reservedQty`), the default "Кількість до
   * замовлення"; `sourceRequirementId` links a PO line created from this
   * row back to the requirement, so receiving it auto-reserves for this
   * order. Undefined for ASSEMBLY lines (reservations don't cover
   * purchased-whole sub-assemblies — see StockReservationService's header
   * comment).
   */
  reservedQty?: number;
  qtyToPurchase?: number;
  sourceRequirementId?: string;
}

export interface SupplierGroup {
  supplierId: string | null;
  supplierName: string;
  lines: ShortageLine[];
}

const NO_SUPPLIER_BUCKET_NAME = 'Без постачальника'; // preserved verbatim from the legacy UI (Phase 1 §6.3)

/**
 * The recursive shortage-collection engine (`collectShortageGroups_`,
 * Phase 1 §3.4/§6.3) — by the project's own documentation, "the most
 * algorithmically involved function in the codebase." Walks every line's
 * assembly tree recursively across the WHOLE order using a shared, mutable
 * pool (`productPool`/`assemblyBuyPool`), NOT independent per-line totals
 * — this is a deliberate, documented fix for a real historical bug: an
 * earlier per-item-only version undercounted shortages when two products
 * in the same order shared a common component. The same shared pool is now
 * also what stock reservations are tracked against (2026-08-19
 * simplification pass) — one reservation per (order, product), not per line.
 *
 * Recursion rule for an ASSEMBLY-type BOM line: if that sub-assembly has a
 * `defaultSupplierId`, it's added as a buy-line for that supplier at its
 * full needed quantity — the tree does NOT recurse further past it, since
 * it's purchased finished, not manufactured in-house. If it has no
 * `defaultSupplierId`, the walk recurses into its own components ("we make
 * it ourselves"). This is the opposite default from `AssembliesService`'s
 * cost/availability logic (BOM module, Module 5), which always flattens
 * fully regardless of `defaultSupplierId` — the two modules read the same
 * field for two entirely different purposes, by design (see
 * AssembliesService's own header comment).
 */
@Injectable()
export class CustomerOrderShortageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly purchaseOrdersService: PurchaseOrdersService,
    private readonly stockReservationService: StockReservationService,
  ) {}

  /**
   * Called once, right after a customer order is created
   * (CustomerOrdersService#create): by default, every raw-material
   * component gets reserved from whatever's already on hand, no manual
   * decision required — the simplified spec's core request. Persists one
   * OrderMaterialRequirement per (order, product) with `requiredQty` locked
   * at this moment (same "lock at creation" philosophy as
   * ProductionOrder.assemblyVersionId) and `qtyFromStock` set to whatever
   * `reserveCapped` actually managed to grant (never throws — an order is
   * always allowed to exist with some or all of its material unreserved).
   */
  async ensureRequirementsAndAutoReserve(user: RequestUser, orderId: string): Promise<void> {
    const order = await this.prisma.tenant.customerOrder.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) return;
    const { productPool } = await this.buildPools(order.items as any[]);
    if (productPool.size === 0) return;

    const warehouseId = await this.resolveDefaultWarehouseId();
    for (const [productId, requiredQty] of productPool) {
      const grant = await this.stockReservationService.reserveCapped(user, { productId, warehouseId, customerOrderId: orderId, source: 'STOCK' }, requiredQty);
      await this.prisma.tenant.orderMaterialRequirement.upsert({
        where: { customerOrderId_productId: { customerOrderId: orderId, productId } },
        create: {
          customerOrderId: orderId,
          productId,
          requiredQty,
          qtyFromStock: grant.grantedQty,
          qtyToPurchase: Math.max(requiredQty - grant.grantedQty, 0),
          createdById: user.userId,
        } as any,
        update: { requiredQty, qtyFromStock: grant.grantedQty, qtyToPurchase: Math.max(requiredQty - grant.grantedQty, 0) },
      });
    }
  }

  async previewShortage(
    user: RequestUser,
    orderId: string,
  ): Promise<{ orderId: string; groups: SupplierGroup[]; ambiguousLines: ShortageLine[] }> {
    const order = await this.prisma.tenant.customerOrder.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) throw new CodedNotFoundException('CUSTOMER_ORDER_NOT_FOUND', 'Customer order not found.');

    const { productPool, assemblyBuyPool } = await this.buildPools(order.items as any[]);
    const warehouseId = await this.resolveDefaultWarehouseId();

    const products = (await this.prisma.tenant.product.findMany({ where: { id: { in: Array.from(productPool.keys()) } } })) as any[];
    const productById = new Map<string, any>();
    for (const p of products) productById.set(p.id, p);

    const subAssemblies = (await this.prisma.tenant.assembly.findMany({ where: { id: { in: Array.from(assemblyBuyPool.keys()) } } })) as any[];
    const assemblyById = new Map<string, any>();
    for (const a of subAssemblies) assemblyById.set(a.id, a);

    // Real multi-supplier links (ProductSupplier/AssemblySupplier) — a
    // product/assembly with exactly one linked row resolves automatically,
    // same as defaultSupplierId always has; with zero rows, defaultSupplierId
    // is still the fallback (backward compatible with anyone who never
    // adopts the new per-supplier-price feature); with more than one, the
    // line is set aside for the caller to resolve (see ambiguousLines).
    const productSupplierRows = (await this.prisma.tenant.productSupplier.findMany({
      where: { productId: { in: Array.from(productPool.keys()) } },
    })) as any[];
    const assemblySupplierRows = (await this.prisma.tenant.assemblySupplier.findMany({
      where: { assemblyId: { in: Array.from(assemblyBuyPool.keys()) } },
    })) as any[];
    const productLinksByProductId = new Map<string, any[]>();
    for (const row of productSupplierRows) {
      const list = productLinksByProductId.get(row.productId) ?? [];
      list.push(row);
      productLinksByProductId.set(row.productId, list);
    }
    const assemblyLinksByAssemblyId = new Map<string, any[]>();
    for (const row of assemblySupplierRows) {
      const list = assemblyLinksByAssemblyId.get(row.assemblyId) ?? [];
      list.push(row);
      assemblyLinksByAssemblyId.set(row.assemblyId, list);
    }

    const supplierIds = new Set<string>();
    for (const p of products) if (p.defaultSupplierId) supplierIds.add(p.defaultSupplierId);
    for (const a of subAssemblies) if (a.defaultSupplierId) supplierIds.add(a.defaultSupplierId);
    for (const row of productSupplierRows) supplierIds.add(row.supplierId);
    for (const row of assemblySupplierRows) supplierIds.add(row.supplierId);
    const suppliers = (await this.prisma.tenant.supplier.findMany({ where: { id: { in: Array.from(supplierIds) } } })) as any[];
    const supplierById = new Map<string, any>();
    for (const s of suppliers) supplierById.set(s.id, s);

    // Reservation decisions (§ simplified spec) — one row per (order, product), created at order-creation time by ensureRequirementsAndAutoReserve.
    const requirements = productPool.size
      ? await this.prisma.tenant.orderMaterialRequirement.findMany({ where: { customerOrderId: orderId, productId: { in: Array.from(productPool.keys()) } } })
      : [];
    const requirementByProduct = new Map(requirements.map((r) => [r.productId, r]));

    const groups = new Map<string, SupplierGroup>();
    const getGroup = (supplierId: string | null): SupplierGroup => {
      const key = supplierId ?? '__NONE__';
      if (!groups.has(key)) {
        groups.set(key, {
          supplierId,
          supplierName: supplierId ? supplierById.get(supplierId)?.name ?? 'Unknown supplier' : NO_SUPPLIER_BUCKET_NAME,
          lines: [],
        });
      }
      return groups.get(key)!;
    };

    const toSupplierOptions = (links: any[]): SupplierOption[] =>
      links.map((l) => ({
        supplierId: l.supplierId,
        supplierName: supplierById.get(l.supplierId)?.name ?? 'Unknown supplier',
        price: l.price != null ? Number(l.price) : null,
      }));

    const ambiguousLines: ShortageLine[] = [];

    for (const [productId, neededQty] of productPool) {
      const product = productById.get(productId);
      const links = productLinksByProductId.get(productId) ?? [];
      const requirement = requirementByProduct.get(productId);
      // No persisted decision yet — happens for any order created before
      // this feature existed, or whose assembly's BOM gained a new
      // component after the order was placed (buildPools recomputes live
      // from the CURRENT BOM every time, so a later-added component simply
      // has no requirement row from the one-time auto-reserve at creation).
      // Rather than show a flat 0 (which reads as "nothing available" and
      // was the actual bug reported live — saving would then 404 since
      // there was really nothing to update), suggest the same default a
      // fresh order would have gotten: the maximum currently available,
      // computed live, not yet persisted or reserved until the user
      // actually saves it.
      let reservedQty: number;
      let qtyToPurchase: number;
      if (requirement) {
        reservedQty = Number(requirement.qtyFromStock);
        qtyToPurchase = Number(requirement.qtyToPurchase);
      } else {
        const availability = await this.stockReservationService.getAvailability(user, productId, warehouseId);
        reservedQty = Math.max(Math.min(neededQty, availability.available), 0);
        qtyToPurchase = Math.max(neededQty - reservedQty, 0);
      }
      const line: ShortageLine = {
        kind: 'PRODUCT',
        productId,
        description: product ? `${product.article} — ${product.name}` : productId,
        neededQty,
        currentStock: Number(product?.qty ?? 0),
        price: null,
        reservedQty,
        qtyToPurchase,
        sourceRequirementId: requirement?.id,
      };
      if (links.length > 1) {
        ambiguousLines.push({ ...line, supplierOptions: toSupplierOptions(links) });
      } else if (links.length === 1) {
        getGroup(links[0].supplierId).lines.push({
          ...line,
          price: links[0].price != null ? Number(links[0].price) : null,
        });
      } else {
        getGroup(product?.defaultSupplierId ?? null).lines.push({
          ...line,
          price: product?.sellPriceEur != null ? Number(product.sellPriceEur) : null,
        });
      }
    }

    for (const [subAssemblyId, neededQty] of assemblyBuyPool) {
      const assembly = assemblyById.get(subAssemblyId);
      const inStockCount = await this.prisma.tenant.finishedGood.count({
        where: { assemblyId: subAssemblyId, status: 'IN_STOCK' },
      });
      const links = assemblyLinksByAssemblyId.get(subAssemblyId) ?? [];
      const line: ShortageLine = {
        kind: 'ASSEMBLY',
        subAssemblyId,
        description: assembly?.name ?? subAssemblyId,
        neededQty,
        currentStock: inStockCount,
        price: null,
      };
      if (links.length > 1) {
        ambiguousLines.push({ ...line, supplierOptions: toSupplierOptions(links) });
      } else if (links.length === 1) {
        getGroup(links[0].supplierId).lines.push({
          ...line,
          price: links[0].price != null ? Number(links[0].price) : null,
        });
      } else {
        getGroup(assembly?.defaultSupplierId ?? null).lines.push(line);
      }
    }

    return { orderId, groups: Array.from(groups.values()), ambiguousLines };
  }

  /**
   * The "Забронювати зі складу" button — batch-adjusts this order's
   * STOCK-source reservation for one or more products to the given
   * `qtyFromStock` values. Strict (throws on the first line that can't get
   * its full increase — §16: the backend validates, doesn't just trust the
   * frontend), rolling back the whole batch on failure since it all runs in
   * one request transaction.
   *
   * Lazily creates the OrderMaterialRequirement row when it doesn't exist
   * yet (real gap found live: any order created before this feature
   * existed, or whose assembly gained a new BOM component afterward, has
   * no such row — `previewShortage` shows a live-computed suggestion for
   * that case but persists nothing, so saving it here previously 404'd).
   * `requiredQty` for a fresh row is recomputed from the CURRENT BOM, same
   * live walk `previewShortage` itself uses.
   */
  async saveReservationDecisions(user: RequestUser, orderId: string, dto: SaveReservationDecisionsDto) {
    const order = await this.prisma.tenant.customerOrder.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) throw new CodedNotFoundException('CUSTOMER_ORDER_NOT_FOUND', 'Customer order not found.');

    const warehouseId = await this.resolveDefaultWarehouseId();
    let productPool: Map<string, number> | null = null;
    const updated = [];
    for (const decision of dto.decisions) {
      let existing = await this.prisma.tenant.orderMaterialRequirement.findUnique({
        where: { customerOrderId_productId: { customerOrderId: orderId, productId: decision.productId } },
      });
      if (!existing) {
        if (!productPool) {
          productPool = (await this.buildPools(order.items as any[])).productPool;
        }
        const requiredQty = productPool.get(decision.productId);
        if (requiredQty === undefined) {
          throw new CodedBadRequestException('MATERIAL_REQUIREMENT_NOT_A_COMPONENT', `Product ${decision.productId} is not a component of this order's assembly tree.`);
        }
        existing = await this.prisma.tenant.orderMaterialRequirement.create({
          data: { customerOrderId: orderId, productId: decision.productId, requiredQty, qtyFromStock: 0, qtyToPurchase: requiredQty, createdById: user.userId } as any,
        });
      }
      const previous = Number(existing.qtyFromStock);
      const delta = decision.qtyFromStock - previous;
      if (delta > 0) {
        await this.stockReservationService.reserveFromStock(user, { productId: decision.productId, warehouseId, customerOrderId: orderId }, delta);
      } else if (delta < 0) {
        await this.stockReservationService.release(user, { productId: decision.productId, warehouseId, customerOrderId: orderId, source: 'STOCK' }, -delta);
      }
      const row = await this.prisma.tenant.orderMaterialRequirement.update({
        where: { id: existing.id },
        data: { qtyFromStock: decision.qtyFromStock, qtyToPurchase: Math.max(Number(existing.requiredQty) - decision.qtyFromStock, 0) },
      });
      updated.push(row);
    }
    return updated;
  }

  /**
   * Commits the (possibly hand-edited) preview — one PurchaseOrder per
   * group, `sourceCustomerOrderId` set so the link back to this order is
   * traceable, and each line's `sourceRequirementId` (when present) carried
   * through so receiving it auto-reserves for this order.
   */
  async createPurchaseOrdersFromGroups(user: RequestUser, orderId: string, dto: CreatePurchaseOrdersFromGroupsDto) {
    const order = await this.prisma.tenant.customerOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new CodedNotFoundException('CUSTOMER_ORDER_NOT_FOUND', 'Customer order not found.');

    const created = [];
    for (const group of dto.groups) {
      const po = await this.purchaseOrdersService.create(user, {
        supplierId: group.supplierId,
        supplierNameSnapshot: group.supplierName,
        sourceCustomerOrderId: orderId,
        items: group.items.map((line) => ({
          productId: line.kind === 'PRODUCT' ? line.productId : undefined,
          articleSnapshot: line.description,
          productNameSnapshot: line.description,
          qtyOrdered: line.qty,
          expectedPrice: line.price,
          sourceRequirementId: line.sourceRequirementId,
        })),
      });
      created.push(po);
    }
    return created;
  }

  /**
   * `visited` tracks the current ancestor path only (removed on the way
   * back out — same technique as AssembliesService's cost/availability
   * recursion, Module 5), so a legitimate diamond dependency isn't mistaken
   * for a cycle. Shared by `previewShortage` and `ensureRequirementsAndAutoReserve` —
   * both need the SAME whole-order pool, never independent per-line totals.
   */
  private async buildPools(items: Array<{ assemblyId: string; qty: unknown }>): Promise<{ productPool: Map<string, number>; assemblyBuyPool: Map<string, number> }> {
    const productPool = new Map<string, number>();
    const assemblyBuyPool = new Map<string, number>();
    for (const item of items) {
      await this.walkAssembly(item.assemblyId, Number(item.qty), productPool, assemblyBuyPool, new Set());
    }
    return { productPool, assemblyBuyPool };
  }

  private async walkAssembly(
    assemblyId: string,
    qtyOfAssembly: number,
    productPool: Map<string, number>,
    assemblyBuyPool: Map<string, number>,
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
        productPool.set(line.productId, (productPool.get(line.productId) ?? 0) + neededQty);
      } else if (line.componentType === 'ASSEMBLY' && line.subAssemblyId) {
        const subAssembly = await this.prisma.tenant.assembly.findUnique({ where: { id: line.subAssemblyId } });
        if (!subAssembly) continue; // defensive — shouldn't happen given FK integrity

        const hasSupplierLink =
          Boolean(subAssembly.defaultSupplierId) ||
          (await this.prisma.tenant.assemblySupplier.count({ where: { assemblyId: line.subAssemblyId } })) > 0;
        if (hasSupplierLink) {
          assemblyBuyPool.set(line.subAssemblyId, (assemblyBuyPool.get(line.subAssemblyId) ?? 0) + neededQty);
        } else {
          await this.walkAssembly(line.subAssemblyId, neededQty, productPool, assemblyBuyPool, visited);
        }
      }
    }

    visited.delete(assemblyId);
  }

  private async resolveDefaultWarehouseId(): Promise<string> {
    const warehouse = await this.prisma.tenant.warehouse.findFirst({ where: { isDefault: true, deletedAt: null } });
    if (!warehouse) {
      throw new CodedBadRequestException('SHORTAGE_NO_DEFAULT_WAREHOUSE', 'No default warehouse configured — cannot determine where to reserve stock from.');
    }
    return warehouse.id;
  }
}
