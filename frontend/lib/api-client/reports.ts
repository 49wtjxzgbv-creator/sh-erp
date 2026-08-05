import { apiClient } from './http';

/**
 * Typed wrappers for backend/src/modules/reports/ (ReportsController) — three
 * read-only aggregation endpoints, no create/update/delete anywhere in this
 * module. Field shapes copied verbatim from dto/report-queries.dto.ts and
 * reports.service.ts's own exported interfaces.
 *
 * Unlike every other module's api-client, there is no DecimalString-vs-
 * plain-number split to worry about here: all three endpoints return
 * computed aggregation results built from `Number(...)` arithmetic in
 * reports.service.ts, never raw Prisma rows — every numeric field below is
 * a real JSON number.
 *
 * Permission note: `warehouse-valuation` requires `reports:valuation` (cost/
 * price data, admin-only per Phase 1 §5), while the other two endpoints use
 * the more general `reports:read` — a user with report access won't
 * necessarily be able to see valuation.
 */

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

export interface ReorderSuggestionsQuery {
  limit?: number;
}

/** Products where (qty - reserved) < 2x minQty, worst shortfall first. Reservations are recomputed fresh on every call, never stored — only PLANNED production orders' PRODUCT-type BOM lines count. */
export function getReorderSuggestions(query: ReorderSuggestionsQuery = {}): Promise<ReorderSuggestion[]> {
  return apiClient.get<ReorderSuggestion[]>('reports/reorder-suggestions', { query: query as Record<string, number> });
}

export interface CategoryValuation {
  category: string | null;
  productCount: number;
  totalLocalExclVat: number;
  totalLocalInclVat: number;
  totalGermanExclVat: number;
  totalGermanInclVat: number;
  totalSellEur: number;
}

export interface WarehouseValuation {
  byCategory: CategoryValuation[];
  grandTotal: CategoryValuation;
}

/** All 5 legacy price fields, grouped by category — admin-only (reports:valuation). */
export function getWarehouseValuation(): Promise<WarehouseValuation> {
  return apiClient.get<WarehouseValuation>('reports/warehouse-valuation');
}

export interface MonthlyProductionRollupLine {
  assemblyId: string;
  assemblyName: string;
  ordersCount: number;
  unitsProduced: number;
  totalLocalCostEur: number;
  totalGermanCostEur: number;
}

export interface MonthlyProductionRollupQuery {
  /** ISO date. Defaults to the start of the current month. */
  from?: string;
  /** ISO date. Defaults to now. */
  to?: string;
}

/** COMPLETED production orders grouped by assembly over a date range. */
export function getMonthlyProductionRollup(query: MonthlyProductionRollupQuery = {}): Promise<MonthlyProductionRollupLine[]> {
  return apiClient.get<MonthlyProductionRollupLine[]>('reports/monthly-production-rollup', { query: query as Record<string, string> });
}
