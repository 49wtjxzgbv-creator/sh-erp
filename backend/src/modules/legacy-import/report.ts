import type { PrismaService, TenantPrismaClient } from '../../prisma/prisma.service';
import type { LegacyExportPayload, TransformedImportGraph } from './transform';

/**
 * Rich preview/post-import report model — computed by the SAME code for
 * both the dry-run (`validate`) and the real job's final report, so the
 * numbers a user approves before clicking "Імпортувати" are exactly the
 * numbers that show up after. `willCreate`/`willUpdate` need a DB read
 * (batch `findMany` by legacyId, same `{ id: { in: [...] } }` idiom used
 * elsewhere in this codebase), so this lives outside `transform/*`
 * (deliberately kept Prisma-free/pure) and inside the service layer.
 *
 * Opens its OWN `runInTenantTransaction` internally (same idiom as
 * `load.ts`) rather than reading off the ambient `prisma.tenant` getter —
 * real incident this fixes: the `startImport` caller runs this from inside
 * the request's own already-open transaction (fine, ambient context is
 * live there), but the `runImportJob` caller runs it from the un-awaited
 * background job (`void this.runImportJob(...)`), long after that request
 * has returned and its transaction committed. AsyncLocalStorage still
 * propagated the now-closed `tx` into that continuation, so every read
 * here failed with "Transaction already closed: ... committed transaction"
 * once the background job actually reached this code. A fresh, explicit
 * transaction is correct in both cases, not just the background one.
 */

export interface EntityReportLine {
  entity: string;
  total: number;
  willCreate: number;
  willUpdate: number;
  willSkip: number;
  failed?: number; // only set on the post-import report
}

export interface ReportConflict {
  entity: string;
  description: string;
}

export interface ReportIssue {
  step: string;
  message: string;
}

export interface ImportReport {
  protocolVersion?: string;
  connectorVersion?: string;
  entities: EntityReportLine[];
  conflicts: ReportConflict[];
  warnings: ReportIssue[];
  errors: ReportIssue[];
  photosDiscovered: number;
  photosMissing?: number; // only set once the (not-yet-built) photo-migration phase actually attempts each photo
  durationMs?: number; // only set on the post-import report
  loadedCounts?: Record<string, number>; // only set on the post-import report — real counts.load.ts actually wrote, cross-checked against willCreate+willUpdate below
  skippedLedgers?: string[]; // only set on the post-import report — StockMovement/AuditEvent skipped because the company already had rows (see load.ts)
}

/** legacyId-keyed entities (upserted by (companyId, legacyId) in load.ts) — the only ones a meaningful create/update split applies to. */
const LEGACY_ID_ENTITIES = ['products', 'suppliers', 'warehouses', 'assemblies', 'customerOrders'] as const;

export async function buildImportReport(
  prisma: PrismaService,
  companyId: string,
  actorUserId: string,
  payload: LegacyExportPayload,
  graph: TransformedImportGraph,
  meta: { protocolVersion?: string; connectorVersion?: string },
): Promise<ImportReport> {
  // --- Products: has its own exclusion reason (unresolved unit), tracked directly. Pure/sync, so computed outside the transaction and reused both inside it (the diff) and after it (the errors check below). ---
  const productsIncluded = graph.products.filter((p) => p.unitId);
  const productsExcluded = graph.products.length - productsIncluded.length;

  const entities: EntityReportLine[] = await prisma.runInTenantTransaction({ companyId, userId: actorUserId }, async (tx) => {
    const lines: EntityReportLine[] = [];

    const productDiff = await diffByLegacyId(tx, companyId, 'product', productsIncluded.map((p) => p.legacyId));
    lines.push({ entity: 'products', total: graph.products.length, willCreate: productDiff.willCreate, willUpdate: productDiff.willUpdate, willSkip: productsExcluded });

    lines.push(await legacyIdEntityLine(tx, companyId, 'supplier', 'suppliers', graph.suppliers.map((s) => s.legacyId)));
    lines.push(await legacyIdEntityLine(tx, companyId, 'warehouse', 'warehouses', graph.warehouses.map((w) => w.legacyId)));
    lines.push(await legacyIdEntityLine(tx, companyId, 'assembly', 'assemblies', graph.assemblies.map((a) => a.legacyId)));
    lines.push(await legacyIdEntityLine(tx, companyId, 'customerOrder', 'customerOrders', graph.customerOrders.map((c) => c.legacyId)));
    return lines;
  });

  // --- Entities without a legacyId-based idempotency key: report total + skip (rows dropped by transform due to unresolved references), no meaningful create/update split (see load.ts — replace-on-run or upsert-by-composite-key, not upsert-by-legacyId). ---
  entities.push(skipOnlyLine('assemblyComponents', payload.assemblyComponents?.length ?? 0, graph.assemblyComponents.length));
  entities.push(skipOnlyLine('assemblyVersions', payload.assemblyVersions?.length ?? 0, graph.assemblyVersions.length));
  entities.push(skipOnlyLine('customerOrderItems', payload.customerOrderItems?.length ?? 0, graph.customerOrderItems.length));
  entities.push({ entity: 'warehouseStock', total: graph.warehouseStock.length, willCreate: graph.warehouseStock.length, willUpdate: 0, willSkip: 0 });
  entities.push({ entity: 'stockMovements', total: graph.stockMovements.length, willCreate: graph.stockMovements.length, willUpdate: 0, willSkip: 0 });
  entities.push({ entity: 'newUnits', total: graph.newUnits.length, willCreate: graph.newUnits.length, willUpdate: 0, willSkip: 0 });

  const conflicts = detectConflicts(graph);

  const errors: ReportIssue[] = conflicts.map((c) => ({ step: 'conflicts', message: c.description }));
  if (graph.products.length > 0 && productsIncluded.length === 0) {
    errors.push({ step: 'products', message: 'Жоден товар не вдалося підготувати до імпорту — перевірте колонку Unit (одиниця виміру) у аркуші Products.' });
  }

  return {
    protocolVersion: meta.protocolVersion,
    connectorVersion: meta.connectorVersion,
    entities,
    conflicts,
    warnings: graph.warnings,
    errors,
    photosDiscovered: graph.photoRefs.length,
  };
}

async function legacyIdEntityLine(
  tx: TenantPrismaClient,
  companyId: string,
  model: 'supplier' | 'warehouse' | 'assembly' | 'customerOrder',
  entity: string,
  legacyIds: string[],
): Promise<EntityReportLine> {
  const diff = await diffByLegacyId(tx, companyId, model, legacyIds);
  return { entity, total: legacyIds.length, willCreate: diff.willCreate, willUpdate: diff.willUpdate, willSkip: 0 };
}

async function diffByLegacyId(
  tx: TenantPrismaClient,
  companyId: string,
  model: 'product' | 'supplier' | 'warehouse' | 'assembly' | 'customerOrder',
  legacyIds: string[],
): Promise<{ willCreate: number; willUpdate: number }> {
  if (legacyIds.length === 0) return { willCreate: 0, willUpdate: 0 };
  const existing = await (tx[model] as { findMany: (args: unknown) => Promise<{ legacyId: string | null }[]> }).findMany({
    where: { companyId, legacyId: { in: legacyIds } },
    select: { legacyId: true },
  });
  const existingSet = new Set(existing.map((r) => r.legacyId));
  const willUpdate = legacyIds.filter((id) => existingSet.has(id)).length;
  return { willCreate: legacyIds.length - willUpdate, willUpdate };
}

function skipOnlyLine(entity: string, payloadCount: number, graphCount: number): EntityReportLine {
  const willSkip = Math.max(0, payloadCount - graphCount);
  return { entity, total: payloadCount, willCreate: graphCount, willUpdate: 0, willSkip };
}

/**
 * v1 conflict detection: two rows in the SAME export with different
 * legacyId claiming the same natural key (Product.article) — a real
 * data-integrity problem worth surfacing before import, not just a
 * per-row warning. Extensible: more rules can be added here without
 * touching the report shape or the callers.
 */
function detectConflicts(graph: TransformedImportGraph): ReportConflict[] {
  const conflicts: ReportConflict[] = [];
  const articleToLegacyIds = new Map<string, Set<string>>();
  for (const p of graph.products) {
    if (!p.article) continue;
    const set = articleToLegacyIds.get(p.article) ?? new Set<string>();
    set.add(p.legacyId);
    articleToLegacyIds.set(p.article, set);
  }
  for (const [article, ids] of articleToLegacyIds) {
    if (ids.size > 1) {
      conflicts.push({ entity: 'products', description: `Артикул "${article}" використано у ${ids.size} різних товарах джерела — буде імпортовано лише останній.` });
    }
  }
  return conflicts;
}
