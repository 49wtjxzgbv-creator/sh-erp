import { Injectable } from '@nestjs/common';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { MonthlyProductionRollupQueryDto, ReorderSuggestionsQueryDto } from './dto/report-queries.dto';

export interface ReorderSuggestion {
  productId: string;
  article: string;
  name: string;
  qty: number;
  reserved: number;
  available: number;
  minQty: number;
  target: number;
  suggestedOrderQty: number;
}

/** Costed from Product.sellPriceEur — the one price every calculation in this app is pinned to. localPriceExclVat/localPriceInclVat/germanPriceExclVat/germanPriceInclVat are informational reference fields only and are deliberately NOT summed into a report total anywhere (real behavior change from the original 5-parallel-total port — see this method's own comment). */
export interface CategoryValuation {
  category: string | null;
  productCount: number;
  totalValue: number;
}

export interface MonthlyProductionRollupLine {
  assemblyId: string;
  assemblyName: string;
  ordersCount: number;
  unitsProduced: number;
  totalLocalCostEur: number;
  totalGermanCostEur: number;
}

/**
 * Reports.gs (Phase 1 §3.6) — three read-only aggregation endpoints, ported
 * as closely as their underlying calculations allow:
 *  - Reorder suggestions: target = 2× `minQty`, using *available* =
 *    `qty` minus reservations, exactly as documented. Reservations are
 *    recomputed fresh on every call, never stored (same "recomputed from
 *    all planned orders every time" design as the legacy
 *    `getReservedQtyMap_`, Phase 1 §3.3) — batched into 2 queries total
 *    regardless of product/order count, not one query per product, per
 *    the same N+1 lesson Module 9's payroll summary already applied.
 *  - Warehouse valuation: qty × `sellPriceEur` (the one price every
 *    calculation in this app is pinned to — the other 4 legacy price
 *    fields the original port summed in parallel are informational
 *    reference data only, not part of any calculated total), grouped by
 *    category, admin-only (`reports:valuation`) because it's cost/price
 *    data (Phase 1 §5).
 *  - Monthly production rollup: COMPLETED `ProductionOrder`s grouped by
 *    assembly over a date range.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reservations mirror exactly what `ProductionOrdersService.start()`
   * would consume for PRODUCT-type BOM lines — one level, not recursive
   * (ASSEMBLY-type lines are satisfied by FIFO-consuming already-built
   * FinishedGoods at start time, not by reserving raw materials up front;
   * see that service's own header comment). Only PLANNED orders count —
   * an IN_PROGRESS/COMPLETED order has already physically consumed its
   * components, so counting it again here would double-reserve.
   */
  async getReorderSuggestions(user: RequestUser, query: ReorderSuggestionsQueryDto): Promise<ReorderSuggestion[]> {
    const products = await this.prisma.tenant.product.findMany({ where: { deletedAt: null } });

    const plannedOrders = await this.prisma.tenant.productionOrder.findMany({
      where: { status: 'PLANNED' },
    });
    const versionIds = (plannedOrders as any[]).map((o) => o.assemblyVersionId).filter((v): v is string => Boolean(v));
    const unitsPlannedByVersion = new Map<string, number>();
    for (const order of plannedOrders as any[]) {
      if (order.assemblyVersionId) {
        unitsPlannedByVersion.set(
          order.assemblyVersionId,
          (unitsPlannedByVersion.get(order.assemblyVersionId) ?? 0) + Number(order.unitsPlanned),
        );
      }
    }

    const versionComponents = versionIds.length
      ? await this.prisma.tenant.assemblyVersionComponent.findMany({
          where: { assemblyVersionId: { in: versionIds }, componentType: 'PRODUCT' },
        })
      : [];

    const reservedByProduct = new Map<string, number>();
    for (const line of versionComponents as any[]) {
      const plannedUnits = unitsPlannedByVersion.get(line.assemblyVersionId) ?? 0;
      const reserved = plannedUnits * Number(line.qtyPerUnit);
      reservedByProduct.set(line.productId, (reservedByProduct.get(line.productId) ?? 0) + reserved);
    }

    const suggestions: ReorderSuggestion[] = [];
    for (const product of products as any[]) {
      const minQty = Number(product.minQty);
      if (minQty <= 0) continue; // no reorder point configured — nothing to suggest against

      const reserved = reservedByProduct.get(product.id) ?? 0;
      const available = Number(product.qty) - reserved;
      const target = 2 * minQty;
      if (available < target) {
        suggestions.push({
          productId: product.id,
          article: product.article,
          name: product.name,
          qty: Number(product.qty),
          reserved,
          available,
          minQty,
          target,
          suggestedOrderQty: target - available,
        });
      }
    }

    const limit = query.limit ?? 200;
    return suggestions.sort((a, b) => b.suggestedOrderQty - a.suggestedOrderQty).slice(0, limit);
  }

  async getWarehouseValuation(user: RequestUser): Promise<{ byCategory: CategoryValuation[]; grandTotal: CategoryValuation }> {
    const products = await this.prisma.tenant.product.findMany({ where: { deletedAt: null } });

    const byCategory = new Map<string | null, CategoryValuation>();
    const grandTotal: CategoryValuation = { category: null, productCount: 0, totalValue: 0 };

    for (const product of products as any[]) {
      const qty = Number(product.qty);
      const category = product.category ?? null;
      if (!byCategory.has(category)) {
        byCategory.set(category, { category, productCount: 0, totalValue: 0 });
      }
      const line = byCategory.get(category)!;

      // sellPriceEur only — see CategoryValuation's own comment.
      const value = qty * Number(product.sellPriceEur ?? 0);

      line.productCount += 1;
      line.totalValue += value;

      grandTotal.productCount += 1;
      grandTotal.totalValue += value;
    }

    return {
      byCategory: Array.from(byCategory.values()).sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '')),
      grandTotal,
    };
  }

  async getMonthlyProductionRollup(
    user: RequestUser,
    query: MonthlyProductionRollupQueryDto,
  ): Promise<MonthlyProductionRollupLine[]> {
    const now = new Date();
    const from = query.from ? new Date(query.from) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = query.to ? new Date(query.to) : now;

    const orders = await this.prisma.tenant.productionOrder.findMany({
      where: { status: 'COMPLETED', completedAt: { gte: from, lte: to } },
    });

    const assemblyIds = Array.from(new Set((orders as any[]).map((o) => o.assemblyId)));
    const assemblies = assemblyIds.length
      ? await this.prisma.tenant.assembly.findMany({ where: { id: { in: assemblyIds } } })
      : [];
    const assemblyNameById = new Map<string, string>();
    for (const a of assemblies as any[]) assemblyNameById.set(a.id, a.name);

    const rollupByAssembly = new Map<string, MonthlyProductionRollupLine>();
    for (const order of orders as any[]) {
      if (!rollupByAssembly.has(order.assemblyId)) {
        rollupByAssembly.set(order.assemblyId, {
          assemblyId: order.assemblyId,
          assemblyName: assemblyNameById.get(order.assemblyId) ?? order.assemblyId,
          ordersCount: 0,
          unitsProduced: 0,
          totalLocalCostEur: 0,
          totalGermanCostEur: 0,
        });
      }
      const line = rollupByAssembly.get(order.assemblyId)!;
      line.ordersCount += 1;
      line.unitsProduced += Number(order.unitsPlanned);
      line.totalLocalCostEur += Number(order.totalLocalCostEur ?? 0);
      line.totalGermanCostEur += Number(order.totalGermanCostEur ?? 0);
    }

    return Array.from(rollupByAssembly.values()).sort((a, b) => b.unitsProduced - a.unitsProduced);
  }
}
