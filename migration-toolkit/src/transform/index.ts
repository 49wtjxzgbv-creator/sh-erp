import { randomUUID } from 'node:crypto';
import type { MigrationSnapshot, RawRow, CompanyMigrationInput } from '../types';
import { LegacyIdMap } from './id-map';
import { SEED_UNIT_NAMES, collectRequiredUnitNames, planUnitCreation, resolveUnitId } from './units';
import { transformProductRow } from './products';
import { parseComponentsJson, transformAssemblyComponentRow, type ComponentResolutionContext, type AssemblyVersionComponentRecord } from './bom';
import { parsePickListJson, resolvePickListItems, parseStageHistoryJson, parseAssignedWorkersJson } from './production-json';
import { parseChecklistJson } from './qc-json';
import { computeDefaultWarehouseRemainder } from './warehouse-remainder';
import { classifyHistoryRow } from './history-classify';
import { computeQtyAfterSeries } from './stock-movement-balance';
import {
  parseDecimalString, parseDecimalStringOrZero, parseIntOrUndefined,
  parseLegacyDate, parseLegacyBoolean, parseOptionalString, parseRequiredString,
} from './parsing';

/**
 * Transform orchestrator — Phase 4 design doc §2.2's 9-step dependency
 * order, wired end to end. Pure in the sense the design doc requires
 * ("entirely in memory / against the local snapshot, before anything
 * touches Postgres") — this module never imports `@prisma/client` and never
 * opens a database connection; it only builds a plain-object "company
 * graph" that `load.ts` then writes inside one transaction. Every id is
 * generated client-side via `randomUUID()` (the same pattern
 * `CompanyService.createCompany` already uses for its own company/owner
 * ids, so `PrismaService.runInTenantTransaction`'s RLS `SET LOCAL` can be
 * active from the very first statement in `load.ts`).
 *
 * Legacy `Users.Role` mapping (a real, disclosed judgment call): the legacy
 * system has exactly 3 hardcoded roles — `admin`/`storekeeper`/`viewer`
 * (confirmed from `permissions.catalogue.ts`'s own header comment, not
 * guessed) — while the new system seeds 5 (`Admin`/`Storekeeper`/
 * `Production`/`Sales`/`Viewer`, Phase 2 §6). A migrated user's legacy role
 * maps 1:1 to its same-named new role; there is no legacy equivalent for
 * `Production`/`Sales`, so no migrated user is ever auto-assigned to them —
 * an operator can re-assign roles after cutover via the real Users/Roles UI
 * (Task 77's admin module) if a legacy "storekeeper" should really become
 * "Production" going forward.
 */
const LEGACY_ROLE_TO_NEW_ROLE_NAME: Record<string, string> = {
  admin: 'Admin',
  storekeeper: 'Storekeeper',
  viewer: 'Viewer',
};

export interface TransformWarning {
  step: string;
  message: string;
}

export interface TransformedCompanyGraph {
  company: { id: string; name: string; slug: string; timezone: string; locale: string; legacyId: string | undefined };
  owner: { id: string; email: string; fullName: string; password: string };
  units: { id: string; name: string }[];
  migratedUsers: {
    id: string;
    email: string;
    fullName: string;
    login: string | null;
    legacyPasswordHash: string | null;
    active: boolean;
    roleName: string;
  }[];
  suppliers: { id: string; legacyId: string; name: string; contactPerson: string | null; phone: string | null; email: string | null; notes: string | null; createdAt: Date | undefined }[];
  employees: { id: string; legacyId: string; fullName: string; position: string | null; phone: string | null; hireDate: Date | undefined; status: 'ACTIVE' | 'INACTIVE'; notes: string | null }[];
  warehouses: { id: string; legacyId: string; name: string; isDefault: boolean; createdAt: Date | undefined }[];
  productionStages: { id: string; name: string; sortOrder: number }[];
  qcChecklistItems: { id: string; name: string; sortOrder: number }[];
  products: ({ id: string } & ReturnType<typeof transformProductRow>['record'])[];
  assemblies: { id: string; legacyId: string; name: string; article: string | null; note: string | null; laborCostPerUnit: string; packagingCostPerUnit: string; deliveryCostPerUnit: string; otherCostPerUnit: string; defaultSupplierId: string | undefined; createdAt: Date | undefined }[];
  assemblyComponents: (AssemblyVersionComponentRecord & { id: string; assemblyId: string })[];
  assemblyVersions: { id: string; assemblyId: string; versionNumber: number; createdAt: Date | undefined; components: AssemblyVersionComponentRecord[] }[];
  warehouseStock: { id: string; productId: string; warehouseId: string; qty: string }[];
  productionOrders: {
    id: string; legacyId: string; assemblyId: string; assemblyVersionId: string | undefined; unitsPlanned: string; status: string;
    createdAt: Date | undefined; completedAt: Date | undefined; comment: string | null;
    currentStageIndex: number | undefined;
    totalLocalCostEur: string | undefined; totalGermanCostEur: string | undefined;
    laborCostEur: string | undefined; packagingCostEur: string | undefined; deliveryCostEur: string | undefined; otherCostEur: string | undefined; fullCostEur: string | undefined;
    pickListItems: ReturnType<typeof resolvePickListItems>['resolved'];
    stageEvents: { stageIndex: number; actorUserId: string; createdAt: Date | undefined }[];
    workers: { employeeId: string; percent: string }[];
  }[];
  finishedGoods: { id: string; legacyId: string; serialNumber: string; assemblyId: string; productionOrderId: string; manufactureDate: Date | undefined; status: string; customerOrderId: string | undefined; comment: string | null; unitCostLocalEur: string; unitCostGermanEur: string; consumedInProductionOrderId: string | undefined; _legacyCustomerOrderId: string | undefined }[];
  qcChecks: { id: string; finishedGoodId: string; result: 'ACCEPTED' | 'REWORK'; comment: string | null; checkedAt: Date | undefined; results: { itemName: string; passed: boolean }[] }[];
  customerOrders: { id: string; legacyId: string; orderNumber: string | null; clientName: string; contactPerson: string | null; deadline: Date | undefined; priority: string; status: string; comment: string | null; createdAt: Date | undefined }[];
  customerOrderItems: { id: string; customerOrderId: string; assemblyId: string; qty: string; productionOrderId: string | undefined }[];
  shipments: { id: string; legacyId: string; carrier: string | null; waybillNumber: string | null; packageCount: number | undefined; weightKg: string | undefined; dimensions: string | null; status: string; customerOrderId: string | undefined; comment: string | null; shipDate: Date | undefined; deliveryDate: Date | undefined; createdAt: Date | undefined }[];
  shipmentItems: { id: string; shipmentId: string; finishedGoodId: string }[];
  purchaseOrders: { id: string; legacyId: string; supplierId: string | undefined; supplierNameSnapshot: string; status: string; orderDate: Date | undefined; expectedDeliveryDate: Date | undefined; comment: string | null; sourceCustomerOrderId: string | undefined; createdAt: Date | undefined }[];
  purchaseOrderItems: { id: string; purchaseOrderId: string; productId: string | undefined; articleSnapshot: string; productNameSnapshot: string; qtyOrdered: string; qtyReceived: string; expectedPrice: string | undefined; actualPrice: string | undefined }[];
  inventorySessions: { id: string; legacyId: string; name: string; status: string; comment: string | null; startedAt: Date | undefined; completedAt: Date | undefined }[];
  inventoryItems: { id: string; inventorySessionId: string; productId: string | undefined; expectedQty: string; actualQty: string | undefined; counted: boolean }[];
  payrollEntries: { id: string; legacyId: string; employeeId: string; type: string; productionOrderId: string | undefined; unitsProduced: string | undefined; amount: string; entryDate: Date | undefined; comment: string | null; createdAt: Date | undefined }[];
  stockMovements: { id: string; productId: string; type: string; qtyDelta: string; qtyAfter: string; comment: string | null; createdAt: Date | undefined }[];
  auditEvents: { id: string; action: string; entityType: string; entityId: string | undefined; metadata: Record<string, unknown>; createdAt: Date | undefined }[];
  warnings: TransformWarning[];
  /** Every legacyId -> newId mapping recorded across every entity namespace this run touched — exposed so verify.ts's spot-check sampling (Phase 4 design doc §2.4) can resolve an arbitrary legacy row id back to its loaded row generically, without each verify check re-deriving its own lookup map. */
  idMap: LegacyIdMap;
}

const PAYROLL_TYPE_MAP: Record<string, string> = {
  piecework: 'PIECEWORK',
  advance: 'ADVANCE',
  bonus: 'BONUS',
  penalty: 'PENALTY',
};

function rows<K extends keyof MigrationSnapshot['sheets']>(snapshot: MigrationSnapshot, key: K): RawRow[] {
  return snapshot.sheets[key]?.rows ?? [];
}

export function transformCompany(snapshot: MigrationSnapshot, input: CompanyMigrationInput): TransformedCompanyGraph {
  const warnings: TransformWarning[] = [];
  const warn = (step: string, message: string) => warnings.push({ step, message });
  const ids = new LegacyIdMap();

  // --- Step 1: Company row (operator-supplied metadata, not sheet data) ---
  const companyId = randomUUID();
  const ownerUserId = randomUUID();
  const company = {
    id: companyId,
    name: input.companyName,
    slug: input.companySlug,
    timezone: input.timezone ?? 'Europe/Kyiv',
    locale: input.locale ?? 'uk',
    legacyId: input.sourceDeploymentId,
  };
  const owner = { id: ownerUserId, email: input.ownerEmail, fullName: input.ownerFullName, password: input.ownerPassword };

  // --- Step 2: Seed data — CompanyUnit resolution/creation must happen before any Product row (decision 1) ---
  const productRows = rows(snapshot, 'products');
  const requiredUnitNames = collectRequiredUnitNames(productRows);
  const unitPlan = planUnitCreation(requiredUnitNames);
  // Every SEED_UNIT_NAME is always created too, even if unused by any real Product row today — matches normal (non-migration) signup's seedDefaults behavior, so a migrated company's unit dropdown isn't missing options a normal company would have.
  const allUnitNamesToCreate = Array.from(new Set([...SEED_UNIT_NAMES, ...unitPlan.seeded, ...unitPlan.adHoc]));
  const units = allUnitNamesToCreate.map((name) => ({ id: randomUUID(), name }));
  const unitIdByName = new Map(units.map((u) => [u.name, u.id]));
  if (unitPlan.adHoc.length > 0) {
    warn('seed-units', `Created ${unitPlan.adHoc.length} ad hoc CompanyUnit row(s) beyond the 6 seed defaults, used by real Product rows: ${unitPlan.adHoc.join(', ')}.`);
  }

  // Legacy Users -> migratedUsers (CompanyMembership rows loaded separately by load.ts, since User is a global model). No email column exists on the legacy Users sheet at all — synthesizes a placeholder company-scoped email per user, a real disclosed judgment call (Phase 4 design doc doesn't address this — the legacy schema genuinely has no email field to preserve).
  const migratedUsers = rows(snapshot, 'users').map((row) => {
    const legacyId = String(row.ID ?? '');
    const login = parseOptionalString(row.Login);
    const email = login ? `${login}@${input.companySlug}.legacy.local` : `user-${legacyId}@${input.companySlug}.legacy.local`;
    const legacyRole = typeof row.Role === 'string' ? row.Role.trim().toLowerCase() : '';
    const roleName = LEGACY_ROLE_TO_NEW_ROLE_NAME[legacyRole];
    if (!roleName) warn('users', `User legacyId=${legacyId} login=${login ?? ''}: unrecognized legacy Role "${row.Role}" — defaulted to Viewer (least-privilege fallback).`);
    const newId = randomUUID();
    ids.set('user', legacyId, newId);
    return {
      id: newId,
      email,
      fullName: parseOptionalString(row.FullName) ?? login ?? `Legacy user ${legacyId}`,
      login,
      legacyPasswordHash: parseOptionalString(row.PasswordHash), // unsalted SHA-256 — populates User.legacyPasswordHash, NOT passwordHash, so the existing transparent re-hash-on-login (ADR-0006) upgrades it exactly like an org that migrated its own DB directly
      active: parseLegacyBoolean(row.Active),
      roleName: roleName ?? 'Viewer',
    };
  });
  warn('seed-emails', `Legacy Users sheet has no email column — every migrated user was given a synthesized placeholder email (login@${input.companySlug}.legacy.local). The company owner should have every real user update their email after first login.`);

  // --- Step 3: Reference/lookup entities ---
  const suppliers = rows(snapshot, 'suppliers').map((row) => {
    const legacyId = String(row.ID ?? '');
    const newId = randomUUID();
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
  const supplierIdByLegacyId = new Map(suppliers.map((s) => [s.legacyId, s.id]));

  const employees = rows(snapshot, 'employees').map((row) => {
    const legacyId = String(row.ID ?? '');
    const newId = randomUUID();
    ids.set('employee', legacyId, newId);
    return {
      id: newId,
      legacyId,
      fullName: parseRequiredString(row.FullName, `(unnamed employee, legacyId=${legacyId})`).value,
      position: parseOptionalString(row.Position),
      phone: parseOptionalString(row.Phone),
      hireDate: parseLegacyDate(row.HireDate),
      status: (parseOptionalString(row.Status)?.toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE') as 'ACTIVE' | 'INACTIVE',
      notes: parseOptionalString(row.Notes),
    };
  });
  const employeeIdByLegacyId = new Map(employees.map((e) => [e.legacyId, e.id]));

  // ProductionStage/QcChecklistItem: real per-company data from their own sheets (Phase 3 §5), NOT the seed-default list Phase 4's design doc mentions in step 2 — that list is what a NORMAL signup gets (CompanyService.createCompany deliberately does NOT seed these, per its own header comment: "the legacy system has no fixed default list for either"). A migration has real legacy rows to carry forward instead, which is strictly more faithful. Disclosed here since this deviates from a literal reading of the design doc.
  const productionStages = rows(snapshot, 'productionStages').map((row) => ({
    id: randomUUID(),
    name: parseRequiredString(row.Name, '(unnamed stage)').value,
    sortOrder: parseIntOrUndefined(row.SortOrder) ?? 0,
  }));
  const qcChecklistItems = rows(snapshot, 'qcChecklist').map((row) => ({
    id: randomUUID(),
    name: parseRequiredString(row.Name, '(unnamed checklist item)').value,
    sortOrder: parseIntOrUndefined(row.SortOrder) ?? 0,
  }));

  // --- Step 4: Product ---
  const products = productRows.map((row) => {
    const result = transformProductRow(row, { unitIdByName, supplierIdByLegacyId });
    result.warnings.forEach((w) => warn('products', w));
    const id = randomUUID();
    ids.set('product', result.record.legacyId, id);
    return { id, ...result.record };
  });
  const productIdByLegacyId = new Map(products.map((p) => [p.legacyId, p.id]));
  const productIdByArticle = new Map(products.filter((p) => p.article).map((p) => [p.article, p.id]));

  // --- Step 6a (warehouses, needed before BOM's warehouseId resolution) ---
  const warehouses = rows(snapshot, 'warehouses').map((row) => {
    const legacyId = String(row.ID ?? '');
    const newId = randomUUID();
    ids.set('warehouse', legacyId, newId);
    return {
      id: newId,
      legacyId,
      name: parseRequiredString(row.Name, `(unnamed warehouse, legacyId=${legacyId})`).value,
      isDefault: parseLegacyBoolean(row.IsDefault),
      createdAt: parseLegacyDate(row.CreatedAt),
    };
  });
  const warehouseIdByLegacyId = new Map(warehouses.map((w) => [w.legacyId, w.id]));
  const defaultWarehouse = warehouses.find((w) => w.isDefault) ?? warehouses[0];
  if (!defaultWarehouse) warn('warehouses', 'No warehouse found in the source sheet at all (not even one marked IsDefault) — the default-warehouse-remainder step (§2.2 step 6) will have nowhere to materialize stock and will be skipped entirely.');

  // --- Step 5: Assembly, AssemblyComponent (current BOM), AssemblyVersion + ComponentsJson (Phase 3 §4) ---
  const assemblies = rows(snapshot, 'assemblies').map((row) => {
    const legacyId = String(row.ID ?? '');
    const newId = randomUUID();
    ids.set('assembly', legacyId, newId);
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
  const assemblyIdByLegacyId = new Map(assemblies.map((a) => [a.legacyId, a.id]));

  const componentResolutionCtx: ComponentResolutionContext = { productIdByLegacyId, assemblyIdByLegacyId, warehouseIdByLegacyId };
  // Built below, after assemblyVersions — used by ProductionOrder to resolve BOMVersionNumber (Setup.gs's ProductionOrders header) back to a real AssemblyVersion row (schema's own documented "nullable for legacy rows predating BOM versioning" case, Phase 4 design doc §2.2 step 7).
  const assemblyVersionIdByAssemblyAndNumber = new Map<string, string>();

  const assemblyComponents = rows(snapshot, 'assemblyComponents')
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

  const assemblyVersions = rows(snapshot, 'assemblyVersions')
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
        versionNumber: parseIntOrUndefined(row.VersionNumber) ?? 1,
        createdAt: parseLegacyDate(row.CreatedAt),
        components,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== undefined);
  for (const v of assemblyVersions) {
    assemblyVersionIdByAssemblyAndNumber.set(`${v.assemblyId}::${v.versionNumber}`, v.id);
  }

  // --- Step 6b: WarehouseStock, including the materialized default-warehouse remainder ---
  const explicitStockRows = rows(snapshot, 'warehouseStock');
  const explicitStockByProductLegacyId = new Map<string, { warehouseLegacyId: string; qty: string }[]>();
  for (const row of explicitStockRows) {
    const legacyProductId = String(row.ProductID ?? '');
    const list = explicitStockByProductLegacyId.get(legacyProductId) ?? [];
    list.push({ warehouseLegacyId: String(row.WarehouseID ?? ''), qty: parseDecimalStringOrZero(row.Qty).value });
    explicitStockByProductLegacyId.set(legacyProductId, list);
  }

  const warehouseStock: TransformedCompanyGraph['warehouseStock'] = [];
  for (const row of productRows) {
    const legacyProductId = String(row.ID ?? '');
    const productId = productIdByLegacyId.get(legacyProductId);
    if (!productId) continue; // already warned during Product transform (blank unit, etc.)
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
        warn('warehouse-stock', `Product legacyId=${legacyProductId} article=${String(row.Article ?? '')}: computed default-warehouse remainder is NEGATIVE (${remainder}) — named-warehouse stock exceeds total Qty in the source data. Loaded as-is; flag for manual review, do not treat this company's stock numbers as trustworthy until resolved.`);
      }
      warehouseStock.push({ id: randomUUID(), productId, warehouseId: defaultWarehouse.id, qty: remainder });
    }
  }

  // --- Step 8a: FinishedGoods (needed before ProductionOrder pick-list resolution, and before Shipments/QCChecks) ---
  const finishedGoods = rows(snapshot, 'finishedGoods').map((row) => {
    const legacyId = String(row.ID ?? '');
    const newId = randomUUID();
    ids.set('finishedGood', legacyId, newId);
    const legacyAssemblyId = String(row.AssemblyID ?? '');
    const legacyProductionOrderId = String(row.ProductionOrderID ?? '');
    return {
      id: newId,
      legacyId,
      serialNumber: parseRequiredString(row.SerialNumber, `SN-LEGACY-${legacyId}`).value,
      assemblyId: assemblyIdByLegacyId.get(legacyAssemblyId) ?? '',
      productionOrderId: legacyProductionOrderId, // resolved to a real UUID in a second pass below, after ProductionOrders are built (forward reference)
      manufactureDate: parseLegacyDate(row.ManufactureDate),
      status: parseOptionalString(row.Status)?.toUpperCase() ?? 'IN_STOCK',
      customerOrderId: undefined as string | undefined, // resolved below, after CustomerOrders are built
      comment: parseOptionalString(row.Comment),
      unitCostLocalEur: parseDecimalStringOrZero(row.UnitCostLocalEur).value,
      unitCostGermanEur: parseDecimalStringOrZero(row.UnitCostGermanEur).value,
      consumedInProductionOrderId: parseOptionalString(row.ConsumedInProductionOrderID) ?? undefined, // resolved below too
      _legacyCustomerOrderId: parseOptionalString(row.CustomerOrderID) ?? undefined,
    };
  });
  const finishedGoodIdBySerial = new Map(finishedGoods.map((f) => [f.serialNumber, f.id]));
  const finishedGoodLegacyIdToNewId = new Map(finishedGoods.map((f) => [f.legacyId, f.id]));

  // --- Step 7: ProductionOrder + 3 expansion tables (Phase 3 §4) ---
  const productionOrders = rows(snapshot, 'productionOrders').map((row) => {
    const legacyId = String(row.ID ?? '');
    const newId = randomUUID();
    ids.set('productionOrder', legacyId, newId);

    const { items: pickListItems, warnings: pickWarnings } = parsePickListJson(row.PickListJson);
    pickWarnings.forEach((w) => warn('production-orders', `ProductionOrder legacyId=${legacyId}: ${w}`));
    const { resolved: resolvedPickList, warnings: resolveWarnings } = resolvePickListItems(
      pickListItems, productIdByArticle, finishedGoodIdBySerial, `ProductionOrder legacyId=${legacyId} PickListJson`,
    );
    resolveWarnings.forEach((w) => warn('production-orders', w));

    const { events: stageEventsRaw, warnings: stageWarnings } = parseStageHistoryJson(row.StageHistoryJson);
    stageWarnings.forEach((w) => warn('production-orders', `ProductionOrder legacyId=${legacyId}: ${w}`));
    // NOTE: StageHistoryJson's "user" field is a login string (see ParsedStageEvent.legacyUserLogin), not a legacy row id — the id-map is keyed by legacy row ID, so it can never resolve a login string directly. This is a real, disclosed gap: without a login->legacyId cross-reference in the source data, stage-event authorship falls back to the migration operator's own owner account rather than inventing a match. The stageIndex/timestamp facts are still preserved exactly.
    const stageEvents = stageEventsRaw.map((e) => ({ stageIndex: e.stageIndex, actorUserId: ownerUserId, createdAt: e.createdAt }));
    if (stageEventsRaw.length > 0) warn('production-orders', `ProductionOrder legacyId=${legacyId}: ${stageEventsRaw.length} StageHistoryJson event(s) had their actorUserId attributed to the migration owner account, not the original legacy user — StageHistoryJson only records a login string, which this schema has no reliable way to resolve back to a specific migrated User without a name/login cross-reference. Timestamps and stage indexes are preserved exactly.`);

    const { workers: workersRaw, warnings: workerWarnings } = parseAssignedWorkersJson(row.AssignedWorkersJson);
    workerWarnings.forEach((w) => warn('production-orders', `ProductionOrder legacyId=${legacyId}: ${w}`));
    const workers = workersRaw
      .map((w) => {
        const employeeId = employeeIdByLegacyId.get(w.legacyEmployeeId);
        if (!employeeId) {
          warn('production-orders', `ProductionOrder legacyId=${legacyId}: AssignedWorkersJson references employeeId "${w.legacyEmployeeId}" which did not resolve — worker entry excluded.`);
          return undefined;
        }
        return { employeeId, percent: w.percent };
      })
      .filter((w): w is NonNullable<typeof w> => w !== undefined);

    const legacyAssemblyId = String(row.AssemblyID ?? '');
    const assemblyId = assemblyIdByLegacyId.get(legacyAssemblyId);
    if (!assemblyId) warn('production-orders', `ProductionOrder legacyId=${legacyId}: AssemblyID "${legacyAssemblyId}" did not resolve to a migrated Assembly — this order cannot be loaded (required FK).`);

    // BOMVersionNumber -> AssemblyVersion (nullable — the schema's own comment documents this as expected for rows predating BOM versioning, not an error condition).
    const bomVersionNumber = parseIntOrUndefined(row.BOMVersionNumber);
    const assemblyVersionId = assemblyId && bomVersionNumber !== undefined
      ? assemblyVersionIdByAssemblyAndNumber.get(`${assemblyId}::${bomVersionNumber}`)
      : undefined;

    return {
      id: newId,
      legacyId,
      assemblyId: assemblyId ?? '',
      assemblyVersionId,
      unitsPlanned: parseDecimalStringOrZero(row.UnitsPlanned).value,
      status: parseOptionalString(row.Status)?.toUpperCase() ?? 'PLANNED',
      createdAt: parseLegacyDate(row.CreatedAt),
      completedAt: parseLegacyDate(row.CompletedAt),
      comment: parseOptionalString(row.Comment),
      currentStageIndex: parseIntOrUndefined(row.CurrentStageIndex),
      totalLocalCostEur: parseDecimalString(row.TotalLocalCostEur),
      totalGermanCostEur: parseDecimalString(row.TotalGermanCostEur),
      laborCostEur: parseDecimalString(row.LaborCostEur),
      packagingCostEur: parseDecimalString(row.PackagingCostEur),
      deliveryCostEur: parseDecimalString(row.DeliveryCostEur),
      otherCostEur: parseDecimalString(row.OtherCostEur),
      fullCostEur: parseDecimalString(row.FullCostEur),
      pickListItems: resolvedPickList,
      stageEvents,
      workers,
    };
  });
  const productionOrderIdByLegacyId = new Map(productionOrders.map((po) => [po.legacyId, po.id]));

  // Second pass on FinishedGoods: resolve productionOrderId/consumedInProductionOrderId now that ProductionOrders exist.
  for (const fg of finishedGoods) {
    const resolvedProductionOrderId = productionOrderIdByLegacyId.get(fg.productionOrderId);
    if (!resolvedProductionOrderId) warn('finished-goods', `FinishedGood legacyId=${fg.legacyId} serial=${fg.serialNumber}: ProductionOrderID did not resolve to a migrated ProductionOrder (required FK) — this row cannot be loaded.`);
    fg.productionOrderId = resolvedProductionOrderId ?? '';
    if (fg.consumedInProductionOrderId) {
      fg.consumedInProductionOrderId = productionOrderIdByLegacyId.get(fg.consumedInProductionOrderId);
    }
  }

  // --- Step 8b: QcChecks + ChecklistJson (Phase 3 §4) ---
  const qcChecks = rows(snapshot, 'qcChecks')
    .map((row) => {
      const legacySerial = String(row.SerialNumber ?? '');
      const finishedGoodId = finishedGoodIdBySerial.get(legacySerial);
      if (!finishedGoodId) {
        warn('qc-checks', `QcCheck legacyId=${String(row.ID ?? '')}: SerialNumber "${legacySerial}" did not resolve to a migrated FinishedGood — row excluded.`);
        return undefined;
      }
      const { results, warnings: blobWarnings } = parseChecklistJson(row.ChecklistJson);
      blobWarnings.forEach((w) => warn('qc-checks', `QcCheck serial=${legacySerial}: ${w}`));
      const resultRaw = parseOptionalString(row.Result)?.toLowerCase();
      return {
        id: randomUUID(),
        finishedGoodId,
        result: (resultRaw === 'accepted' ? 'ACCEPTED' : 'REWORK') as 'ACCEPTED' | 'REWORK',
        comment: parseOptionalString(row.Comment),
        checkedAt: parseLegacyDate(row.CheckedAt),
        results,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== undefined);

  // --- Step 8c: CustomerOrders + Items ---
  const customerOrders = rows(snapshot, 'customerOrders').map((row) => {
    const legacyId = String(row.ID ?? '');
    const newId = randomUUID();
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
  const customerOrderIdByLegacyId = new Map(customerOrders.map((co) => [co.legacyId, co.id]));

  const customerOrderItems = rows(snapshot, 'customerOrderItems')
    .map((row) => {
      const legacyCustomerOrderId = String(row.CustomerOrderID ?? '');
      const customerOrderId = customerOrderIdByLegacyId.get(legacyCustomerOrderId);
      const legacyAssemblyId = String(row.AssemblyID ?? '');
      const assemblyId = assemblyIdByLegacyId.get(legacyAssemblyId);
      if (!customerOrderId || !assemblyId) {
        warn('customer-order-items', `CustomerOrderItem legacyId=${String(row.ID ?? '')}: CustomerOrderID or AssemblyID did not resolve — row excluded.`);
        return undefined;
      }
      const legacyProductionOrderId = parseOptionalString(row.ProductionOrderID);
      return {
        id: randomUUID(),
        customerOrderId,
        assemblyId,
        qty: parseDecimalStringOrZero(row.Qty).value,
        productionOrderId: legacyProductionOrderId ? productionOrderIdByLegacyId.get(legacyProductionOrderId) : undefined,
      };
    })
    .filter((i): i is NonNullable<typeof i> => i !== undefined);

  // Resolve FinishedGood.customerOrderId now that CustomerOrders exist.
  for (const fg of finishedGoods) {
    if (fg._legacyCustomerOrderId) fg.customerOrderId = customerOrderIdByLegacyId.get(fg._legacyCustomerOrderId);
  }

  // --- Step 8d: Shipments + Items ---
  const shipments = rows(snapshot, 'shipments').map((row) => {
    const legacyId = String(row.ID ?? '');
    const newId = randomUUID();
    ids.set('shipment', legacyId, newId);
    const legacyCustomerOrderId = parseOptionalString(row.CustomerOrderID);
    return {
      id: newId,
      legacyId,
      carrier: parseOptionalString(row.Carrier),
      waybillNumber: parseOptionalString(row.WaybillNumber),
      packageCount: parseIntOrUndefined(row.PackageCount),
      weightKg: parseDecimalString(row.Weight),
      dimensions: parseOptionalString(row.Dimensions),
      status: parseOptionalString(row.Status)?.toUpperCase() ?? 'SHIPPED',
      customerOrderId: legacyCustomerOrderId ? customerOrderIdByLegacyId.get(legacyCustomerOrderId) : undefined,
      comment: parseOptionalString(row.Comment),
      shipDate: parseLegacyDate(row.ShipDate),
      deliveryDate: parseLegacyDate(row.DeliveryDate),
      createdAt: parseLegacyDate(row.CreatedAt),
    };
  });
  const shipmentIdByLegacyId = new Map(shipments.map((s) => [s.legacyId, s.id]));

  const shipmentItems = rows(snapshot, 'shipmentItems')
    .map((row) => {
      const legacyShipmentId = String(row.ShipmentID ?? '');
      const shipmentId = shipmentIdByLegacyId.get(legacyShipmentId);
      const legacySerial = String(row.SerialNumber ?? '');
      const finishedGoodId = finishedGoodIdBySerial.get(legacySerial);
      if (!shipmentId || !finishedGoodId) {
        warn('shipment-items', `ShipmentItem legacyId=${String(row.ID ?? '')}: ShipmentID or SerialNumber did not resolve — row excluded.`);
        return undefined;
      }
      return { id: randomUUID(), shipmentId, finishedGoodId };
    })
    .filter((i): i is NonNullable<typeof i> => i !== undefined);

  // --- Step 8e: PurchaseOrders + Items ---
  const purchaseOrders = rows(snapshot, 'purchaseOrders').map((row) => {
    const legacyId = String(row.ID ?? '');
    const newId = randomUUID();
    ids.set('purchaseOrder', legacyId, newId);
    const legacySupplierId = parseOptionalString(row.SupplierId);
    const legacySourceCustomerOrderId = parseOptionalString(row.SourceCustomerOrderID);
    const supplierId = legacySupplierId ? supplierIdByLegacyId.get(legacySupplierId) : undefined;
    if (legacySupplierId && !supplierId) warn('purchase-orders', `PurchaseOrder legacyId=${legacyId}: SupplierId "${legacySupplierId}" did not resolve — left null, supplierNameSnapshot preserves the free-text name (mirrors the old system's own "free-text supplier allowed" tolerance, Phase 1 §10.6).`);
    return {
      id: newId,
      legacyId,
      supplierId,
      supplierNameSnapshot: parseRequiredString(row.Supplier, '(unknown supplier)').value,
      status: parseOptionalString(row.Status)?.toUpperCase() ?? 'ORDERED',
      orderDate: parseLegacyDate(row.OrderDate),
      expectedDeliveryDate: parseLegacyDate(row.ExpectedDeliveryDate),
      comment: parseOptionalString(row.Comment),
      sourceCustomerOrderId: legacySourceCustomerOrderId ? customerOrderIdByLegacyId.get(legacySourceCustomerOrderId) : undefined,
      createdAt: parseLegacyDate(row.CreatedAt),
    };
  });
  const purchaseOrderIdByLegacyId = new Map(purchaseOrders.map((po) => [po.legacyId, po.id]));

  const purchaseOrderItems = rows(snapshot, 'purchaseOrderItems')
    .map((row) => {
      const legacyPurchaseOrderId = String(row.PurchaseOrderID ?? '');
      const purchaseOrderId = purchaseOrderIdByLegacyId.get(legacyPurchaseOrderId);
      if (!purchaseOrderId) {
        warn('purchase-order-items', `PurchaseOrderItem legacyId=${String(row.ID ?? '')}: PurchaseOrderID did not resolve — row excluded.`);
        return undefined;
      }
      const article = parseOptionalString(row.Article) ?? '';
      return {
        id: randomUUID(),
        purchaseOrderId,
        productId: productIdByArticle.get(article), // old system allowed ordering an article not yet in Products (Phase 1 §10.7) — left undefined (null) if unmatched, same as the real backend's own tolerance
        articleSnapshot: article,
        productNameSnapshot: parseOptionalString(row.ProductName) ?? '',
        qtyOrdered: parseDecimalStringOrZero(row.QtyOrdered).value,
        qtyReceived: parseDecimalStringOrZero(row.QtyReceived).value,
        expectedPrice: parseDecimalString(row.ExpectedPrice),
        actualPrice: parseDecimalString(row.ActualPrice),
      };
    })
    .filter((i): i is NonNullable<typeof i> => i !== undefined);

  // --- Step 8f: InventorySessions + Items ---
  const inventorySessions = rows(snapshot, 'inventorySessions').map((row) => {
    const legacyId = String(row.ID ?? '');
    const newId = randomUUID();
    ids.set('inventorySession', legacyId, newId);
    return {
      id: newId,
      legacyId,
      name: parseRequiredString(row.Name, `(unnamed session, legacyId=${legacyId})`).value,
      status: parseOptionalString(row.Status)?.toUpperCase() ?? 'IN_PROGRESS',
      comment: parseOptionalString(row.Comment),
      startedAt: parseLegacyDate(row.StartedAt),
      completedAt: parseLegacyDate(row.CompletedAt),
    };
  });
  const inventorySessionIdByLegacyId = new Map(inventorySessions.map((s) => [s.legacyId, s.id]));

  const inventoryItems = rows(snapshot, 'inventoryItems')
    .map((row) => {
      const legacySessionId = String(row.InventorySessionID ?? '');
      const inventorySessionId = inventorySessionIdByLegacyId.get(legacySessionId);
      if (!inventorySessionId) {
        warn('inventory-items', `InventoryItem legacyId=${String(row.ID ?? '')}: InventorySessionID did not resolve — row excluded.`);
        return undefined;
      }
      const legacyProductId = parseOptionalString(row.ProductID);
      return {
        id: randomUUID(),
        inventorySessionId,
        productId: legacyProductId ? productIdByLegacyId.get(legacyProductId) : undefined,
        expectedQty: parseDecimalStringOrZero(row.ExpectedQty).value,
        actualQty: parseDecimalString(row.ActualQty),
        counted: parseLegacyBoolean(row.Counted),
      };
    })
    .filter((i): i is NonNullable<typeof i> => i !== undefined);

  // --- Step 8g: PayrollEntries ---
  const payrollEntries = rows(snapshot, 'payrollEntries')
    .map((row) => {
      const legacyId = String(row.ID ?? '');
      const legacyEmployeeId = String(row.EmployeeID ?? '');
      const employeeId = employeeIdByLegacyId.get(legacyEmployeeId);
      if (!employeeId) {
        warn('payroll-entries', `PayrollEntry legacyId=${legacyId}: EmployeeID "${legacyEmployeeId}" did not resolve — row excluded (required FK).`);
        return undefined;
      }
      const legacyType = typeof row.Type === 'string' ? row.Type.toLowerCase() : '';
      const type = PAYROLL_TYPE_MAP[legacyType];
      if (!type) warn('payroll-entries', `PayrollEntry legacyId=${legacyId}: unrecognized Type "${row.Type}" — defaulted to ADVANCE.`);
      const legacyProductionOrderId = parseOptionalString(row.ProductionOrderID);
      return {
        id: randomUUID(),
        legacyId,
        employeeId,
        type: type ?? 'ADVANCE',
        productionOrderId: legacyProductionOrderId ? productionOrderIdByLegacyId.get(legacyProductionOrderId) : undefined,
        unitsProduced: parseDecimalString(row.UnitsProduced),
        amount: parseDecimalStringOrZero(row.Amount).value,
        entryDate: parseLegacyDate(row.EntryDate),
        comment: parseOptionalString(row.Comment),
        createdAt: parseLegacyDate(row.CreatedAt),
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== undefined);

  // --- Step 9: History -> StockMovement (structured) + AuditEvent (everything else), Phase 3 §6 ---
  const stockMovements: TransformedCompanyGraph['stockMovements'] = [];
  const auditEvents: TransformedCompanyGraph['auditEvents'] = [];
  for (const row of rows(snapshot, 'history')) {
    const action = parseOptionalString(row.Action) ?? '';
    const article = parseOptionalString(row.Article) ?? '';
    const qty = Number(row.Qty) || 0;
    const classification = classifyHistoryRow({ action, article, qty });
    const createdAt = parseLegacyDate(row.Timestamp);
    if (classification.kind === 'STOCK_MOVEMENT') {
      const productId = productIdByArticle.get(article);
      if (!productId) {
        warn('history', `History row action="${action}" article="${article}": classified as a stock movement but the article did not resolve to a migrated Product — downgraded to AuditEvent instead.`);
        auditEvents.push({ id: randomUUID(), action, entityType: 'HistoryImport', entityId: undefined, metadata: { article, name: row.Name, qty, comment: row.Comment, legacyUser: row.User }, createdAt });
        continue;
      }
      // qtyAfter is filled in below, once every product's stock movements are collected — see computeQtyAfterSeries (backward reconstruction from the known-correct final Products.Qty, since the legacy History sheet never stored a running balance).
      stockMovements.push({ id: randomUUID(), productId, type: classification.movementType, qtyDelta: String(qty), qtyAfter: '', comment: parseOptionalString(row.Comment), createdAt });
    } else {
      auditEvents.push({ id: randomUUID(), action, entityType: 'HistoryImport', entityId: undefined, metadata: { article, name: row.Name, qty, comment: row.Comment, legacyUser: row.User, reason: classification.reason }, createdAt });
    }
  }

  // Reconstruct qtyAfter for every stock movement — see stock-movement-balance.ts's header comment for why this can't just be read off the source data. stockMovements is already in true chronological order (the History sheet's own row order — logHistory_ always appendRow's, confirmed from History.gs), so no separate date-sort is attempted.
  const finalQtyByProductId = new Map(products.filter((p) => p.unitId).map((p) => [p.id, p.qty]));
  const qtyAfterByMovementId = computeQtyAfterSeries(stockMovements, finalQtyByProductId);
  for (const m of stockMovements) {
    const computed = qtyAfterByMovementId.get(m.id);
    if (computed === undefined) {
      warn('history', `StockMovement id=${m.id} productId=${m.productId}: could not reconstruct qtyAfter (product has no resolved final qty) — fell back to qtyDelta, which is almost certainly WRONG. Flag this product's stock history for manual review.`);
      m.qtyAfter = m.qtyDelta;
    } else {
      m.qtyAfter = computed;
    }
  }

  return {
    company, owner, units, migratedUsers, suppliers, employees, warehouses,
    productionStages, qcChecklistItems, products, assemblies, assemblyComponents,
    assemblyVersions, warehouseStock, productionOrders, finishedGoods, qcChecks,
    customerOrders, customerOrderItems, shipments, shipmentItems, purchaseOrders,
    purchaseOrderItems, inventorySessions, inventoryItems, payrollEntries,
    stockMovements, auditEvents, warnings, idMap: ids,
  };
}
