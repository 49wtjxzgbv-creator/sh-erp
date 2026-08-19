import { Injectable } from '@nestjs/common';
import { CodedConflictException, CodedNotFoundException } from '../../common/api-exceptions';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { PurchaseOrdersService } from '../procurement/purchase-orders.service';
import { CreatePurchaseOrdersFromGroupsDto } from './dto/shortage-analysis.dto';

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
 * assembly tree recursively across the WHOLE order using shared, mutable
 * pools (`productPool`/`assemblyBuyPool`), NOT independent per-line totals
 * — this is a deliberate, documented fix for a real historical bug: an
 * earlier per-item-only version undercounted shortages when two products
 * in the same order shared a common component.
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
 *
 * **Explicit, documented product decision, preserved exactly**: this never
 * subtracts current stock automatically. `previewShortage` returns the
 * full gross requirement AND the current stock/finished-goods count for
 * each line, side by side — the human compares them and adjusts the
 * quantity by hand before `createPurchaseOrdersFromGroups` commits
 * anything. Reintroducing automatic netting here would reintroduce the
 * exact bug this design avoids.
 */
@Injectable()
export class CustomerOrderShortageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly purchaseOrdersService: PurchaseOrdersService,
  ) {}

  async previewShortage(
    user: RequestUser,
    orderId: string,
  ): Promise<{ orderId: string; groups: SupplierGroup[]; ambiguousLines: ShortageLine[] }> {
    const order = await this.prisma.tenant.customerOrder.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) throw new CodedNotFoundException('CUSTOMER_ORDER_NOT_FOUND', 'Customer order not found.');

    const productPool = new Map<string, number>();
    const assemblyBuyPool = new Map<string, number>();

    for (const item of order.items as any[]) {
      await this.walkAssembly(item.assemblyId, Number(item.qty), productPool, assemblyBuyPool, new Set());
    }

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
      const line: ShortageLine = {
        kind: 'PRODUCT',
        productId,
        description: product ? `${product.article} — ${product.name}` : productId,
        neededQty,
        currentStock: Number(product?.qty ?? 0),
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
   * Commits the (possibly hand-edited) preview — one PurchaseOrder per
   * group, `sourceCustomerOrderId` set so the link back to this order is
   * traceable (PurchaseOrder.sourceCustomerOrderId, wired up in the schema
   * since Phase 3 specifically for this).
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
        })),
      });
      created.push(po);
    }
    return created;
  }

  /**
   * Single-line variant of the same recursive walk `previewShortage` uses
   * for a whole order's shared pool — reused (not duplicated) by
   * `MaterialProvisioningService` (stock-reservation spec §11/§12), which
   * needs the flattened raw-PRODUCT requirement for exactly ONE
   * CustomerOrderItem's assembly tree, not the whole order's merged pool.
   * Deliberately drops the ASSEMBLY-buy pool (purchased-whole sub-
   * assemblies) — the reservation system is scoped to raw materials that
   * actually live in WarehouseStock; see that service's header comment for
   * the disclosed reason purchased-whole sub-assemblies aren't covered.
   */
  async getProductRequirements(assemblyId: string, qtyOfAssembly: number): Promise<Map<string, number>> {
    const productPool = new Map<string, number>();
    const assemblyBuyPool = new Map<string, number>();
    await this.walkAssembly(assemblyId, qtyOfAssembly, productPool, assemblyBuyPool, new Set());
    return productPool;
  }

  /**
   * `visited` tracks the current ancestor path only (removed on the way
   * back out — same technique as AssembliesService's cost/availability
   * recursion, Module 5), so a legitimate diamond dependency isn't mistaken
   * for a cycle.
   */
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
}
