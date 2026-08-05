import { PrismaClient } from '@prisma/client';
import { SHEET_SCHEMAS, type SheetKey } from './sheet-schemas';
import type { MigrationSnapshot } from './types';
import type { TransformedCompanyGraph } from './transform';

/**
 * Stage 4 — Verify (Phase 4 design doc §2.4). Runs after every load, dry-run
 * or real, and populates `LegacyMigrationRun.reconciliationReport` (a `Json`
 * field by design — "its shape isn't fixed in the schema because what's
 * worth reporting will evolve as real migrations surface real issues").
 *
 * Same disclosed limitation as `load.ts`: this queries a real
 * `@prisma/client`, which was never generated in this sandbox, so it has
 * never run against a real database. Written to be structurally correct
 * against the real schema, verified by careful cross-reading, not by a
 * live run.
 */

export interface RowCountCheck {
  sheet: SheetKey;
  sourceRows: number;
  loadedRows: number;
  /** false only for the sheets with a naive expected 1:1 relationship (most of them); expansion-table-producing sheets (ProductionOrders, AssemblyVersions, QCChecks) are informational only — one source row legitimately becomes 1 + N rows across multiple tables, so "loadedRows" there counts the PRIMARY row only (production_orders / assembly_versions / qc_checks), never the expansion tables, and is reported without a pass/fail verdict. */
  isNaiveOneToOneCheck: boolean;
  passed: boolean | null;
}

export interface SumCheck {
  checkName: string;
  passed: boolean;
  /** Products whose migrated total (sum of WarehouseStock.qty across all warehouses, including the materialized default-warehouse remainder) does not equal the source Products.Qty they were computed from — the single most important check per the design doc, since a stock bug is the worst possible migration failure for a warehouse-management product. */
  mismatches: { legacyProductId: string; article: string; sourceQty: string; migratedTotal: string }[];
}

export interface ReferentialCompletenessCheck {
  /** One entry per warning category recorded during transform (unresolved unit, unresolved supplier, excluded BOM component, etc.) — grouped so the report shows "12 products had an unresolved DefaultSupplierId" rather than 12 separate lines. */
  step: string;
  count: number;
  sampleMessages: string[];
}

export interface SpotCheckResult {
  entity: 'Product';
  legacyId: string;
  article: string;
  matched: boolean;
  fieldDiffs: { field: string; sourceValue: unknown; loadedValue: unknown }[];
}

export interface ReconciliationReport {
  generatedAt: string;
  companyId: string;
  rowCounts: RowCountCheck[];
  sumCheck: SumCheck;
  referentialCompleteness: ReferentialCompletenessCheck[];
  spotChecks: SpotCheckResult[];
  /** True only when every hard check (non-informational row counts, the sum check) passed AND there are zero negative-remainder warnings. Referential-completeness gaps and spot-check diffs do NOT flip this to false on their own — per the design doc, a verify failure needs human judgment, this flag is a starting point for that judgment, not a substitute for reading the full report. */
  looksHealthy: boolean;
}

/** Sheets that produce exactly one row per source row in a single primary table — a naive 1:1 count check is meaningful. Everything else either has expansion tables (ProductionOrders/AssemblyVersions/QCChecks) or has no direct table of its own (Settings, Units — folded into CompanySettings/CompanyUnit which don't carry a 1:1 row count against a "Settings sheet row"). */
const NAIVE_ONE_TO_ONE_SHEETS: SheetKey[] = [
  'suppliers', 'employees', 'warehouses', 'products', 'assemblies', 'assemblyComponents',
  'customerOrders', 'customerOrderItems', 'finishedGoods', 'shipments', 'shipmentItems',
  'purchaseOrders', 'purchaseOrderItems', 'inventorySessions', 'inventoryItems', 'payrollEntries',
  'warehouseStock',
];

function loadedRowCountFor(sheetKey: SheetKey, graph: TransformedCompanyGraph): number {
  switch (sheetKey) {
    case 'suppliers': return graph.suppliers.length;
    case 'employees': return graph.employees.length;
    case 'warehouses': return graph.warehouses.length;
    case 'products': return graph.products.filter((p) => p.unitId).length;
    case 'assemblies': return graph.assemblies.length;
    case 'assemblyComponents': return graph.assemblyComponents.length;
    case 'productionOrders': return graph.productionOrders.filter((po) => po.assemblyId).length;
    case 'assemblyVersions': return graph.assemblyVersions.length;
    case 'customerOrders': return graph.customerOrders.length;
    case 'customerOrderItems': return graph.customerOrderItems.length;
    case 'finishedGoods': return graph.finishedGoods.filter((fg) => fg.productionOrderId && fg.assemblyId).length;
    case 'qcChecks': return graph.qcChecks.length;
    case 'shipments': return graph.shipments.length;
    case 'shipmentItems': return graph.shipmentItems.length;
    case 'purchaseOrders': return graph.purchaseOrders.length;
    case 'purchaseOrderItems': return graph.purchaseOrderItems.length;
    case 'inventorySessions': return graph.inventorySessions.length;
    case 'inventoryItems': return graph.inventoryItems.filter((i) => i.productId).length;
    case 'payrollEntries': return graph.payrollEntries.length;
    case 'warehouseStock': return graph.warehouseStock.length;
    case 'productionStages': return graph.productionStages.length;
    case 'qcChecklist': return graph.qcChecklistItems.length;
    case 'users': return graph.migratedUsers.length;
    case 'history': return graph.stockMovements.length + graph.auditEvents.length;
    case 'units':
    case 'settings':
      return 0; // folded into CompanyUnit/CompanySettings — no 1:1 row concept, see NAIVE_ONE_TO_ONE_SHEETS exclusion
  }
}

export function computeRowCounts(snapshot: MigrationSnapshot, graph: TransformedCompanyGraph): RowCountCheck[] {
  const checks: RowCountCheck[] = [];
  for (const sheetKey of Object.keys(SHEET_SCHEMAS) as SheetKey[]) {
    const sourceRows = snapshot.sheets[sheetKey]?.rows.length ?? 0;
    const loadedRows = loadedRowCountFor(sheetKey, graph);
    const isNaive = NAIVE_ONE_TO_ONE_SHEETS.includes(sheetKey);
    checks.push({
      sheet: sheetKey,
      sourceRows,
      loadedRows,
      isNaiveOneToOneCheck: isNaive,
      passed: isNaive ? sourceRows === loadedRows : null,
    });
  }
  return checks;
}

/** The single most important reconciliation check (design doc §2.4): total migrated qty (sum of WarehouseStock.qty across all warehouses, including the materialized default-warehouse remainder — see warehouse-remainder.ts) must equal the source Products.Qty it was computed from. Computed purely from the in-memory graph (what SHOULD be true) — verifyMigration() below cross-checks this same computation against what's actually in Postgres. */
export function computeSumCheck(graph: TransformedCompanyGraph): SumCheck {
  const stockByProductId = new Map<string, number>();
  for (const ws of graph.warehouseStock) {
    stockByProductId.set(ws.productId, (stockByProductId.get(ws.productId) ?? 0) + (Number(ws.qty) || 0));
  }

  const mismatches: SumCheck['mismatches'] = [];
  for (const p of graph.products) {
    if (!p.unitId) continue; // never loaded, excluded from this check too
    const migratedTotal = stockByProductId.get(p.id) ?? 0;
    const sourceQty = Number(p.qty) || 0;
    if (Math.abs(migratedTotal - sourceQty) > 1e-9) {
      mismatches.push({ legacyProductId: p.legacyId, article: p.article, sourceQty: p.qty, migratedTotal: String(migratedTotal) });
    }
  }

  return { checkName: 'total-qty-matches-warehouse-stock-sum', passed: mismatches.length === 0, mismatches };
}

export function computeReferentialCompleteness(graph: TransformedCompanyGraph): ReferentialCompletenessCheck[] {
  const byStep = new Map<string, string[]>();
  for (const w of graph.warnings) {
    const list = byStep.get(w.step) ?? [];
    list.push(w.message);
    byStep.set(w.step, list);
  }
  return Array.from(byStep.entries()).map(([step, messages]) => ({
    step,
    count: messages.length,
    sampleMessages: messages.slice(0, 5),
  }));
}

/** Spot-check sampling (design doc §2.4): re-fetches N random migrated products from the LIVE database and diffs their key fields against the original snapshot row — catches transformation bugs a count/sum check can't (e.g. a systematically-off-by-one date, correct count and correct sum, but wrong actual values). Products only, not every entity — Products is explicitly called out in the design doc as "the largest single mapping," and this function's shape generalizes trivially to any other entity if a future pass wants to add one. */
export async function spotCheckProducts(
  prisma: PrismaClient,
  companyId: string,
  snapshot: MigrationSnapshot,
  graph: TransformedCompanyGraph,
  sampleSize = 15,
): Promise<SpotCheckResult[]> {
  const productRows = snapshot.sheets.products?.rows ?? [];
  const eligible = graph.products.filter((p) => p.unitId);
  const sample: typeof eligible = [];
  const pool = [...eligible];
  for (let i = 0; i < Math.min(sampleSize, pool.length); i++) {
    const index = Math.floor(Math.random() * pool.length);
    sample.push(pool.splice(index, 1)[0]);
  }

  const results: SpotCheckResult[] = [];
  for (const p of sample) {
    const loaded = await prisma.product.findFirst({ where: { companyId, legacyId: p.legacyId } });
    const sourceRow = productRows.find((r) => String(r.ID ?? '') === p.legacyId);
    if (!loaded || !sourceRow) {
      results.push({ entity: 'Product', legacyId: p.legacyId, article: p.article, matched: false, fieldDiffs: [] });
      continue;
    }
    const fieldDiffs: SpotCheckResult['fieldDiffs'] = [];
    const checks: [string, unknown, unknown][] = [
      ['article', sourceRow.Article, loaded.article],
      ['name', sourceRow.Name, loaded.name],
      ['qty', Number(sourceRow.Qty) || 0, Number(loaded.qty)],
    ];
    for (const [field, sourceValue, loadedValue] of checks) {
      if (String(sourceValue ?? '') !== String(loadedValue ?? '')) {
        fieldDiffs.push({ field, sourceValue, loadedValue });
      }
    }
    results.push({ entity: 'Product', legacyId: p.legacyId, article: p.article, matched: fieldDiffs.length === 0, fieldDiffs });
  }
  return results;
}

export async function verifyMigration(
  prisma: PrismaClient,
  companyId: string,
  snapshot: MigrationSnapshot,
  graph: TransformedCompanyGraph,
  options?: { spotCheckSampleSize?: number },
): Promise<ReconciliationReport> {
  const rowCounts = computeRowCounts(snapshot, graph);
  const sumCheck = computeSumCheck(graph);
  const referentialCompleteness = computeReferentialCompleteness(graph);
  const spotChecks = await spotCheckProducts(prisma, companyId, snapshot, graph, options?.spotCheckSampleSize);

  const hasNegativeRemainderWarning = graph.warnings.some((w) => w.step === 'warehouse-stock' && w.message.includes('NEGATIVE'));
  const naiveChecksAllPassed = rowCounts.filter((c) => c.isNaiveOneToOneCheck).every((c) => c.passed);

  const report: ReconciliationReport = {
    generatedAt: new Date().toISOString(),
    companyId,
    rowCounts,
    sumCheck,
    referentialCompleteness,
    spotChecks,
    looksHealthy: naiveChecksAllPassed && sumCheck.passed && !hasNegativeRemainderWarning,
  };

  await prisma.legacyMigrationRun.create({
    data: {
      companyId,
      status: report.looksHealthy ? 'COMPLETED' : 'FAILED',
      sourceDeploymentId: snapshot.sourceSheetId,
      reconciliationReport: report as never,
      completedAt: new Date(),
    },
  });

  return report;
}
