import type { RawRow, RawCellValue } from '../types';
import { parseDecimalString, parseOptionalString } from './parsing';

/**
 * `AssemblyComponents` sheet + `AssemblyVersions.ComponentsJson` blob ->
 * `assembly_components` / `assembly_version_components` (Phase 4 design doc
 * §2.2 step 5, Phase 3 §4). `componentType`/`productId`/`subAssemblyId`
 * consistency is enforced at the DATABASE level by a raw-SQL CHECK
 * constraint (decision 2) — a single inconsistent row would fail the whole
 * company's single-transaction load (§2.3), rolling back everything, not
 * just that row. Per the design doc's own instruction ("transform should
 * validate this itself first ... rather than letting it fail opaquely at
 * load time"), this module makes an explicit judgment call, disclosed here
 * since the design doc doesn't fully specify it: an inconsistent component
 * row is EXCLUDED from the returned list (not passed through to load) and
 * reported as a warning, the same "flag the rest, never silently drop
 * information, never let one bad row sink an entire company's migration"
 * posture used everywhere else in this toolkit (unresolved units,
 * unresolved suppliers, etc.).
 */

export type NormalizedComponentType = 'PRODUCT' | 'ASSEMBLY';

/** Legacy component-type strings are lowercase ('product'/'assembly', confirmed from Assemblies.gs's ComponentsJson-writing code) — normalizes case-insensitively since a manually-edited cell could vary. */
export function normalizeComponentType(raw: RawCellValue): NormalizedComponentType | undefined {
  if (typeof raw !== 'string') return undefined;
  const lower = raw.trim().toLowerCase();
  if (lower === 'product' || lower === 'товар') return 'PRODUCT';
  if (lower === 'assembly' || lower === 'виріб') return 'ASSEMBLY';
  return undefined;
}

export interface AssemblyVersionComponentRecord {
  componentType: NormalizedComponentType;
  productId: string | null;
  subAssemblyId: string | null;
  warehouseId: string | null;
  qtyPerUnit: string;
}

export interface ComponentResolutionContext {
  /** legacy Product ID -> new Product UUID. */
  productIdByLegacyId: ReadonlyMap<string, string>;
  /** legacy Assembly ID -> new Assembly UUID (for subAssemblyId references). */
  assemblyIdByLegacyId: ReadonlyMap<string, string>;
  /** legacy Warehouse ID -> new Warehouse UUID. */
  warehouseIdByLegacyId: ReadonlyMap<string, string>;
}

interface RawComponentJsonEntry {
  componentType?: unknown;
  productId?: unknown;
  subAssemblyId?: unknown;
  warehouseId?: unknown;
  qty?: unknown;
}

function resolveAndValidateOne(
  entry: RawComponentJsonEntry,
  ctx: ComponentResolutionContext,
  describeFor: string,
  warnings: string[],
): AssemblyVersionComponentRecord | undefined {
  const componentType = normalizeComponentType(entry.componentType as RawCellValue);
  if (!componentType) {
    warnings.push(`${describeFor}: unrecognized componentType "${String(entry.componentType)}" — excluded.`);
    return undefined;
  }

  const legacyProductId = typeof entry.productId === 'string' ? entry.productId : undefined;
  const legacySubAssemblyId = typeof entry.subAssemblyId === 'string' ? entry.subAssemblyId : undefined;
  const legacyWarehouseId = typeof entry.warehouseId === 'string' ? entry.warehouseId : undefined;

  const productId = legacyProductId ? ctx.productIdByLegacyId.get(legacyProductId) ?? null : null;
  const subAssemblyId = legacySubAssemblyId ? ctx.assemblyIdByLegacyId.get(legacySubAssemblyId) ?? null : null;
  const warehouseId = legacyWarehouseId ? ctx.warehouseIdByLegacyId.get(legacyWarehouseId) ?? null : null;

  // Mirrors the decision-2 raw-SQL CHECK constraint exactly: PRODUCT rows need productId and no subAssemblyId; ASSEMBLY rows need subAssemblyId and no productId.
  if (componentType === 'PRODUCT') {
    if (!productId) {
      warnings.push(`${describeFor}: componentType=PRODUCT but productId "${legacyProductId ?? ''}" did not resolve — excluded (would violate the componentType/productId CHECK constraint).`);
      return undefined;
    }
    if (subAssemblyId) {
      warnings.push(`${describeFor}: componentType=PRODUCT but a subAssemblyId is also present — excluded (inconsistent source data).`);
      return undefined;
    }
  } else {
    if (!subAssemblyId) {
      warnings.push(`${describeFor}: componentType=ASSEMBLY but subAssemblyId "${legacySubAssemblyId ?? ''}" did not resolve — excluded (would violate the componentType/subAssemblyId CHECK constraint).`);
      return undefined;
    }
    if (productId) {
      warnings.push(`${describeFor}: componentType=ASSEMBLY but a productId is also present — excluded (inconsistent source data).`);
      return undefined;
    }
  }

  const qtyPerUnit = parseDecimalString(entry.qty as RawCellValue) ?? '0';

  return { componentType, productId, subAssemblyId, warehouseId, qtyPerUnit };
}

/** Parses one AssemblyVersions.ComponentsJson blob cell into validated, resolved component records. */
export function parseComponentsJson(
  raw: RawCellValue,
  ctx: ComponentResolutionContext,
  describeFor: string,
): { components: AssemblyVersionComponentRecord[]; warnings: string[] } {
  const warnings: string[] = [];
  if (raw === null || raw === undefined || raw === '') return { components: [], warnings };

  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    warnings.push(`${describeFor}: ComponentsJson is not valid JSON — treated as empty.`);
    return { components: [], warnings };
  }
  if (!Array.isArray(parsed)) {
    warnings.push(`${describeFor}: ComponentsJson is not an array — treated as empty.`);
    return { components: [], warnings };
  }

  const components: AssemblyVersionComponentRecord[] = [];
  parsed.forEach((entry, index) => {
    const resolved = resolveAndValidateOne(entry as RawComponentJsonEntry, ctx, `${describeFor}[${index}]`, warnings);
    if (resolved) components.push(resolved);
  });

  return { components, warnings };
}

/** Maps one live `AssemblyComponents` sheet row (the CURRENT BOM, not a historical version) into the same validated shape. */
export function transformAssemblyComponentRow(
  row: RawRow,
  ctx: ComponentResolutionContext,
): { component: AssemblyVersionComponentRecord | undefined; warnings: string[] } {
  const legacyId = String(row.ID ?? '');
  const entry: RawComponentJsonEntry = {
    componentType: row.ComponentType,
    productId: parseOptionalString(row.ProductID) ?? undefined,
    subAssemblyId: parseOptionalString(row.SubAssemblyID) ?? undefined,
    warehouseId: parseOptionalString(row.WarehouseID) ?? undefined,
    qty: row.Qty,
  };
  const warnings: string[] = [];
  const component = resolveAndValidateOne(entry, ctx, `AssemblyComponent legacyId=${legacyId}`, warnings);
  return { component, warnings };
}
