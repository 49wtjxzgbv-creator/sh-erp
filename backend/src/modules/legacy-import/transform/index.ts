import { randomUUID } from 'node:crypto';
import type { RawRow } from './types';
import { LegacyIdMap } from './id-map';
import { SEED_UNIT_NAMES, collectRequiredUnitNames, planUnitCreation, resolveUnitId } from './units';
import { transformProductRow } from './products';
import { parseComponentsJson, transformAssemblyComponentRow, type ComponentResolutionContext, type AssemblyVersionComponentRecord } from './bom';
import { computeDefaultWarehouseRemainder } from './warehouse-remainder';
import { classifyHistoryRow } from './history-classify';
import { computeQtyAfterSeries } from './stock-movement-balance';
import { parseDecimalStringOrZero, parseLegacyDate, parseOptionalString, parseRequiredString } from './parsing';

/**
 * Transform orchestrator for the universal import platform (any provider
 * that can produce a `LegacyExportPayload` — the SH ERP Import Connector
 * for Google Apps Script is the first, see `../providers/`) — adapted from
 * migration-toolkit/src/transform/index.ts's `transformCompany` (Phase 4
 * design doc §2.2's dependency order), but for a DIFFERENT scenario:
 * `transformCompany` creates a brand-new Company + owner User from a Sheets
 * API extraction; this loads into the CALLER'S OWN EXISTING company from a
 * connector's JSON export, so there is no company/owner/companySettings/
 * user creation here at all — `existingCompanyId` and `actorUserId` (the
 * wizard operator, already authenticated) stand in for those everywhere a
 * `createdById`-shaped field is needed.
 *
 * Scope, disclosed: covers the entity set the import plan names
 * explicitly (товари, вироби/специфікації, замовлення, клієнти,
 * постачальники, складські залишки, історія) — products, suppliers,
 * warehouses+stock, assemblies+BOM (current + versioned), customer orders,
 * and history. Production orders, QC, shipments, purchasing, payroll,
 * inventory sessions, and legacy user accounts are NOT covered by this pass
 * — a real, bounded v1, not an oversight; the same infrastructure
 * (ImportJob, apps-script-client, this orchestrator's shape) extends
 * naturally to them later if needed.
 */

export interface LegacyExportPayload {
  meta?: { exportedAt?: string; deploymentId?: string };
  products: RawRow[];
  suppliers: RawRow[];
  warehouses: RawRow[];
  warehouseStock: RawRow[];
  assemblies: RawRow[];
  assemblyComponents: RawRow[];
  assemblyVersions: RawRow[];
  customerOrders: RawRow[];
  customerOrderItems: RawRow[];
  history: RawRow[];
}

export interface LegacyImportContext {
  /** The existing company this data is loaded into — never a newly generated id, unlike migration-toolkit's transformCompany. */
  companyId: string;
  /** The wizard operator (already an authenticated user of this company) — attributed as `createdById` wherever the schema requires one. */
  actorUserId: string;
  /** Existing CompanyUnit rows already in this company (name -> id) — required BEFORE this runs so ad hoc unit creation doesn't collide with a real, already-existing unit of the same name. */
  existingUnitIdByName: ReadonlyMap<string, string>;
  /**
   * Existing legacyId -> id for every other legacyId-keyed entity type,
   * same reason as `existingUnitIdByName` and just as required — a real
   * incident this fixes: on a RE-RUN against a company that already has
   * data loaded, `load.ts` upserts each of these by `(companyId,
   * legacyId)`, which for an already-existing row hits the UPDATE branch
   * (never touches `id`) — so the row's REAL persisted id is whatever it
   * was assigned on the run that first created it, not whatever fresh
   * `randomUUID()` THIS run's transform happens to generate for the same
   * legacyId. Any OTHER entity that references this row via a
   * legacyId-resolved FK (e.g. `Product.defaultSupplierId`,
   * `AssemblyComponent.productId`) must use the SAME id the row will
   * actually end up with, or that FK fails at load time even though,
   * from this run's own in-memory bookkeeping, everything "resolved
   * correctly" — `products_defaultSupplierId_fkey` was exactly this.
   */
  existingSupplierIdByLegacyId: ReadonlyMap<string, string>;
  existingProductIdByLegacyId: ReadonlyMap<string, string>;
  existingWarehouseIdByLegacyId: ReadonlyMap<string, string>;
  existingAssemblyIdByLegacyId: ReadonlyMap<string, string>;
  existingCustomerOrderIdByLegacyId: ReadonlyMap<string, string>;
}

export interface TransformWarning {
  step: string;
  message: string;
}

export interface TransformedImportGraph {
  newUnits: { id: string; name: string }[];
  products: ({ id: string } & ReturnType<typeof transformProductRow>['record'])[];
  suppliers: { id: string; legacyId: string; name: string; contactPerson: string | null; phone: string | null; email: string | null; notes: string | null; createdAt: Date | undefined }[];
  warehouses: { id: string; legacyId: string; name: string; isDefault: boolean; createdAt: Date | undefined }[];
  warehouseStock: { id: string; productId: string; warehouseId: string; qty: string }[];
  assemblies: { id: string; legacyId: string; name: string; article: string | null; note: string | null; laborCostPerUnit: string; packagingCostPerUnit: string; deliveryCostPerUnit: string; otherCostPerUnit: string; defaultSupplierId: string | undefined; createdAt: Date | undefined }[];
  assemblyComponents: (AssemblyVersionComponentRecord & { id: string; assemblyId: string })[];
  assemblyVersions: { id: string; assemblyId: string; versionNumber: number; createdAt: Date | undefined; components: AssemblyVersionComponentRecord[] }[];
  customerOrders: { id: string; legacyId: string; orderNumber: string | null; clientName: string; contactPerson: string | null; deadline: Date | undefined; priority: string; status: string; comment: string | null; createdAt: Date | undefined }[];
  customerOrderItems: { id: string; customerOrderId: string; assemblyId: string; qty: string }[];
  stockMovements: { id: string; productId: string; type: string; qtyDelta: string; qtyAfter: string; comment: string | null; createdAt: Date | undefined }[];
  auditEvents: { id: string; action: string; entityType: string; entityId: string | undefined; metadata: Record<string, unknown>; createdAt: Date | undefined }[];
  warnings: TransformWarning[];
  idMap: LegacyIdMap;
  /** Every {driveFileId, entityType, entityId} pair discovered from a PhotoUrl-shaped legacy column, collected for Phase 3's photo-import pass — not acted on by THIS transform at all (products/assemblies mapping deliberately omits PhotoUrl, same disclosed boundary as migration-toolkit's own products.ts). */
  photoRefs: { legacyEntityType: 'Product' | 'Assembly'; entityId: string; driveFileId: string }[];
}

function rows(payload: LegacyExportPayload, key: keyof LegacyExportPayload): RawRow[] {
  return (payload[key] as RawRow[] | undefined) ?? [];
}

/**
 * `legacyId -> id` lookup, FIRST occurrence wins — real incident this
 * fixes: a plain `new Map(items.map(x => [x.legacyId, x.id]))` keeps the
 * LAST occurrence when the source sheet has a duplicate legacyId (real,
 * messy legacy data — seen in practice), but `load.ts` upserts by
 * `(companyId, legacyId)`, so the row that actually gets CREATED (and
 * whose id survives forever, since a later same-legacyId row only updates
 * it) is the FIRST occurrence. Any reference resolved through the
 * last-wins map (e.g. a Product's `defaultSupplierId`) could therefore
 * point at an id that was never persisted at all, failing its foreign key
 * at load time. Every legacyId->id map below needs this, not just the one
 * that happened to surface the bug.
 */
function firstIdByLegacyId<T extends { legacyId: string; id: string }>(items: T[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of items) {
    if (!map.has(item.legacyId)) map.set(item.legacyId, item.id);
  }
  return map;
}

export function transformLegacyImport(payload: LegacyExportPayload, ctx: LegacyImportContext): TransformedImportGraph {
  const warnings: TransformWarning[] = [];
  const warn = (step: string, message: string) => warnings.push({ step, message });
  const ids = new LegacyIdMap();
  const photoRefs: TransformedImportGraph['photoRefs'] = [];

  // --- Units: resolve against units already in the target company first, only creating what's genuinely missing (unlike a brand-new company, this company may already have real units with real data attached — never silently create a duplicate-by-name row). ---
  const productRows = rows(payload, 'products');
  const requiredUnitNames = collectRequiredUnitNames(productRows);
  const unitPlan = planUnitCreation(requiredUnitNames);
  const namesAlreadyCovered = new Set(ctx.existingUnitIdByName.keys());
  const namesNeedingCreation = Array.from(new Set([...SEED_UNIT_NAMES, ...unitPlan.seeded, ...unitPlan.adHoc]))
    .filter((name) => !namesAlreadyCovered.has(name));
  const newUnits = namesNeedingCreation.map((name) => ({ id: randomUUID(), name }));
  const unitIdByName = new Map<string, string>([...ctx.existingUnitIdByName, ...newUnits.map((u): [string, string] => [u.name, u.id])]);
  if (unitPlan.adHoc.length > 0) {
    const genuinelyNew = unitPlan.adHoc.filter((n) => !namesAlreadyCovered.has(n));
    if (genuinelyNew.length > 0) warn('units', `Created ${genuinelyNew.length} ad hoc CompanyUnit row(s) beyond the standard defaults, used by real Product rows: ${genuinelyNew.join(', ')}.`);
  }

  // --- Suppliers ---
  const suppliers = rows(payload, 'suppliers').map((row) => {
    const legacyId = String(row.ID ?? '');
    const newId = ctx.existingSupplierIdByLegacyId.get(legacyId) ?? randomUUID();
    ids.set('supplier', legacyId, newId);
    return {
      id: newId,
      legacyId,
      name: parseRequiredString(row.Name, `(unnamed supplier, legacyId=${legacyId})`).value,
      contactPerson: parseOptionalString(row.ContactPerson),
      phone: parseOptionalString(row.Phone),
      email: parseOptionalString(row.Email),
      notes: parseOptionalString(row.Notes),
      createdAt: parseLegacyDate(row.CreatedAt),
    };
  });
  const supplierIdByLegacyId = firstIdByLegacyId(suppliers);

  // --- Products ---
  const products = productRows.map((row) => {
    const result = transformProductRow(row, { unitIdByName, supplierIdByLegacyId });
    result.warnings.forEach((w) => warn('products', w));
    const id = ctx.existingProductIdByLegacyId.get(result.record.legacyId) ?? randomUUID();
    ids.set('product', result.record.legacyId, id);
    const photoUrl = parseOptionalString(row.PhotoUrl);
    if (photoUrl) {
      const driveFileId = extractDriveFileId(photoUrl);
      if (driveFileId) photoRefs.push({ legacyEntityType: 'Product', entityId: id, driveFileId });
    }
    return { id, ...result.record };
  });
  const productIdByLegacyId = firstIdByLegacyId(products);

  // --- Warehouses ---
  const warehouses = rows(payload, 'warehouses').map((row) => {
    const legacyId = String(row.ID ?? '');
    const newId = ctx.existingWarehouseIdByLegacyId.get(legacyId) ?? randomUUID();
    ids.set('warehouse', legacyId, newId);
    return {
      id: newId,
      legacyId,
      name: parseRequiredString(row.Name, `(unnamed warehouse, legacyId=${legacyId})`).value,
      isDefault: String(row.IsDefault ?? '').toString().toLowerCase() === 'true' || row.IsDefault === true,
      createdAt: parseLegacyDate(row.CreatedAt),
    };
  });
  const warehouseIdByLegacyId = firstIdByLegacyId(warehouses);
  const defaultWarehouse = warehouses.find((w) => w.isDefault) ?? warehouses[0];
  if (!defaultWarehouse) warn('warehouses', 'No warehouse found in the source export at all — the default-warehouse-remainder step will have nowhere to materialize stock and will be skipped entirely.');

  // --- Assemblies + AssemblyComponents (current BOM) + AssemblyVersions (ComponentsJson) ---
  const assemblies = rows(payload, 'assemblies').map((row) => {
    const legacyId = String(row.ID ?? '');
    const newId = ctx.existingAssemblyIdByLegacyId.get(legacyId) ?? randomUUID();
    ids.set('assembly', legacyId, newId);
    const photoUrl = parseOptionalString(row.PhotoUrl);
    if (photoUrl) {
      const driveFileId = extractDriveFileId(photoUrl);
      if (driveFileId) photoRefs.push({ legacyEntityType: 'Assembly', entityId: newId, driveFileId });
    }
    return {
      id: newId,
      legacyId,
      name: parseRequiredString(row.Name, `(unnamed assembly, legacyId=${legacyId})`).value,
      article: parseOptionalString(row.Article),
      note: parseOptionalString(row.Note),
      laborCostPerUnit: parseDecimalStringOrZero(row.LaborCostPerUnit).value,
      packagingCostPerUnit: parseDecimalStringOrZero(row.PackagingCostPerUnit).value,
      deliveryCostPerUnit: parseDecimalStringOrZero(row.DeliveryCostPerUnit).value,
      otherCostPerUnit: parseDecimalStringOrZero(row.OtherCostPerUnit).value,
      defaultSupplierId: (() => {
        const legacySupplierId = parseOptionalString(row.DefaultSupplierId);
        return legacySupplierId ? supplierIdByLegacyId.get(legacySupplierId) : undefined;
      })(),
      createdAt: parseLegacyDate(row.CreatedAt),
    };
  });
  const assemblyIdByLegacyId = firstIdByLegacyId(assemblies);

  const componentResolutionCtx: ComponentResolutionContext = { productIdByLegacyId, assemblyIdByLegacyId, warehouseIdByLegacyId };

  const assemblyComponents = rows(payload, 'assemblyComponents')
    .map((row) => {
      const legacyAssemblyId = String(row.AssemblyID ?? '');
      const assemblyId = assemblyIdByLegacyId.get(legacyAssemblyId);
      if (!assemblyId) {
        warn('assembly-components', `AssemblyComponent legacyId=${String(row.ID ?? '')}: AssemblyID "${legacyAssemblyId}" did not resolve to a migrated Assembly — row excluded.`);
        return undefined;
      }
      const { component, warnings: rowWarnings } = transformAssemblyComponentRow(row, componentResolutionCtx);
      rowWarnings.forEach((w) => warn('assembly-components', w));
      if (!component) return undefined;
      return { ...component, id: randomUUID(), assemblyId };
    })
    .filter((c): c is NonNullable<typeof c> => c !== undefined);

  const assemblyVersions = rows(payload, 'assemblyVersions')
    .map((row) => {
      const legacyId = String(row.ID ?? '');
      const legacyAssemblyId = String(row.AssemblyID ?? '');
      const assemblyId = assemblyIdByLegacyId.get(legacyAssemblyId);
      if (!assemblyId) {
        warn('assembly-versions', `AssemblyVersion legacyId=${legacyId}: AssemblyID "${legacyAssemblyId}" did not resolve — row excluded.`);
        return undefined;
      }
      const { components, warnings: blobWarnings } = parseComponentsJson(row.ComponentsJson, componentResolutionCtx, `AssemblyVersion legacyId=${legacyId}`);
      blobWarnings.forEach((w) => warn('assembly-versions', w));
      return {
        id: randomUUID(),
        assemblyId,
        versionNumber: Number(row.VersionNumber) || 1,
        createdAt: parseLegacyDate(row.CreatedAt),
        components,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== undefined);

  // --- WarehouseStock, including the materialized default-warehouse remainder ---
  const explicitStockRows = rows(payload, 'warehouseStock');
  const explicitStockByProductLegacyId = new Map<string, { warehouseLegacyId: string; qty: string }[]>();
  for (const row of explicitStockRows) {
    const legacyProductId = String(row.ProductID ?? '');
    const list = explicitStockByProductLegacyId.get(legacyProductId) ?? [];
    list.push({ warehouseLegacyId: String(row.WarehouseID ?? ''), qty: parseDecimalStringOrZero(row.Qty).value });
    explicitStockByProductLegacyId.set(legacyProductId, list);
  }

  const warehouseStock: TransformedImportGraph['warehouseStock'] = [];
  for (const row of productRows) {
    const legacyProductId = String(row.ID ?? '');
    const productId = productIdByLegacyId.get(legacyProductId);
    if (!productId) continue;
    const explicitRows = explicitStockByProductLegacyId.get(legacyProductId) ?? [];
    for (const explicitRow of explicitRows) {
      const warehouseId = warehouseIdByLegacyId.get(explicitRow.warehouseLegacyId);
      if (!warehouseId) {
        warn('warehouse-stock', `Product legacyId=${legacyProductId}: WarehouseStock references WarehouseID "${explicitRow.warehouseLegacyId}" which did not resolve — that row excluded.`);
        continue;
      }
      warehouseStock.push({ id: randomUUID(), productId, warehouseId, qty: explicitRow.qty });
    }
    if (defaultWarehouse) {
      const productQty = parseDecimalStringOrZero(row.Qty).value;
      const { remainder, isNegative } = computeDefaultWarehouseRemainder(productQty, explicitRows.map((r) => r.qty));
      if (isNegative) {
        warn('warehouse-stock', `Product legacyId=${legacyProductId} article=${String(row.Article ?? '')}: computed default-warehouse remainder is NEGATIVE (${remainder}) — named-warehouse stock exceeds total Qty in the source data. Loaded as-is; flag for manual review.`);
      }
      warehouseStock.push({ id: randomUUID(), productId, warehouseId: defaultWarehouse.id, qty: remainder });
    }
  }

  // --- CustomerOrders + Items (clients are inline on CustomerOrder.clientName — this schema has no separate Customer entity) ---
  const customerOrders = rows(payload, 'customerOrders').map((row) => {
    const legacyId = String(row.ID ?? '');
    const newId = ctx.existingCustomerOrderIdByLegacyId.get(legacyId) ?? randomUUID();
    ids.set('customerOrder', legacyId, newId);
    return {
      id: newId,
      legacyId,
      orderNumber: parseOptionalString(row.OrderNumber),
      clientName: parseRequiredString(row.ClientName, `(unnamed client, legacyId=${legacyId})`).value,
      contactPerson: parseOptionalString(row.ContactPerson),
      deadline: parseLegacyDate(row.Deadline),
      priority: parseOptionalString(row.Priority)?.toUpperCase() ?? 'NORMAL',
      status: parseOptionalString(row.Status)?.toUpperCase() ?? 'NEW',
      comment: parseOptionalString(row.Comment),
      createdAt: parseLegacyDate(row.CreatedAt),
    };
  });
  const customerOrderIdByLegacyId = firstIdByLegacyId(customerOrders);

  const customerOrderItems = rows(payload, 'customerOrderItems')
    .map((row) => {
      const legacyCustomerOrderId = String(row.CustomerOrderID ?? '');
      const customerOrderId = customerOrderIdByLegacyId.get(legacyCustomerOrderId);
      const legacyAssemblyId = String(row.AssemblyID ?? '');
      const assemblyId = assemblyIdByLegacyId.get(legacyAssemblyId);
      if (!customerOrderId || !assemblyId) {
        warn('customer-order-items', `CustomerOrderItem legacyId=${String(row.ID ?? '')}: CustomerOrderID or AssemblyID did not resolve — row excluded.`);
        return undefined;
      }
      return { id: randomUUID(), customerOrderId, assemblyId, qty: parseDecimalStringOrZero(row.Qty).value };
    })
    .filter((i): i is NonNullable<typeof i> => i !== undefined);

  // --- History -> StockMovement (structured) + AuditEvent (everything else) ---
  const stockMovements: TransformedImportGraph['stockMovements'] = [];
  const auditEvents: TransformedImportGraph['auditEvents'] = [];
  for (const row of rows(payload, 'history')) {
    const action = parseOptionalString(row.Action) ?? '';
    const article = parseOptionalString(row.Article) ?? '';
    const qty = Number(row.Qty) || 0;
    const classification = classifyHistoryRow({ action, article, qty });
    const createdAt = parseLegacyDate(row.Timestamp);
    if (classification.kind === 'STOCK_MOVEMENT') {
      const productId = productIdByLegacyId.get(article) ?? productIdByArticleFallback(products, article);
      if (!productId) {
        warn('history', `History row action="${action}" article="${article}": classified as a stock movement but the article did not resolve to a migrated Product — downgraded to AuditEvent instead.`);
        auditEvents.push({ id: randomUUID(), action, entityType: 'HistoryImport', entityId: undefined, metadata: { article, name: row.Name, qty, comment: row.Comment, legacyUser: row.User }, createdAt });
        continue;
      }
      stockMovements.push({ id: randomUUID(), productId, type: classification.movementType, qtyDelta: String(qty), qtyAfter: '', comment: parseOptionalString(row.Comment), createdAt });
    } else {
      auditEvents.push({ id: randomUUID(), action, entityType: 'HistoryImport', entityId: undefined, metadata: { article, name: row.Name, qty, comment: row.Comment, legacyUser: row.User, reason: classification.reason }, createdAt });
    }
  }

  const finalQtyByProductId = new Map(products.filter((p) => p.unitId).map((p) => [p.id, p.qty]));
  const qtyAfterByMovementId = computeQtyAfterSeries(stockMovements, finalQtyByProductId);
  for (const m of stockMovements) {
    const computed = qtyAfterByMovementId.get(m.id);
    if (computed === undefined) {
      warn('history', `StockMovement id=${m.id} productId=${m.productId}: could not reconstruct qtyAfter — fell back to qtyDelta, which is almost certainly WRONG. Flag this product's stock history for manual review.`);
      m.qtyAfter = m.qtyDelta;
    } else {
      m.qtyAfter = computed;
    }
  }

  return {
    newUnits, products, suppliers, warehouses, warehouseStock, assemblies, assemblyComponents,
    assemblyVersions, customerOrders, customerOrderItems, stockMovements, auditEvents, warnings, idMap: ids, photoRefs,
  };
}

function productIdByArticleFallback(products: TransformedImportGraph['products'], article: string): string | undefined {
  return products.find((p) => p.article === article)?.id;
}

/** Legacy PhotoUrl cells are real Google Drive share/view links (`.../d/<fileId>/...` or `?id=<fileId>`) — this extracts just the file id, which Phase 3's photo-import pass re-fetches via the Apps Script `action=photo` endpoint (a Drive share URL is not itself fetchable by the backend — Drive files aren't public). Returns undefined for anything that doesn't look like a Drive link (never guesses). */
export function extractDriveFileId(url: string): string | undefined {
  const dMatch = url.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (dMatch) return dMatch[1];
  const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (idMatch) return idMatch[1];
  return undefined;
}
