import type { Product } from '@/lib/api-client/catalog';

/**
 * Column config for the spreadsheet/grid view — ported from legacy's
 * `SS_COLUMNS` (`spreadsheet.html`/`JavaScript.html`'s "Таблиця товарів
 * (адмін-редактор)" section), with three deliberate, disclosed changes
 * forced by the schema having evolved since the legacy sheet:
 *
 *  - `unit` was free text directly on the product row in legacy (any string
 *    "just worked" as a cell edit); it's now `Product.unitId`, a required
 *    FK to `CompanyUnit` (Phase 3 decision 1). There is no `select`-type
 *    column anywhere in legacy's `SS_COLUMNS` (only text/number/photo) —
 *    this grid adds one real `type: 'unit'` column, rendered as a
 *    `<select>` of the company's units, because the schema now requires it.
 *  - `photoUrl` is dropped entirely — `Product` has no photo column in this
 *    backend at all (confirmed repeatedly across the Excel import/export
 *    and printing work in this same pass); photos are `FileAsset`
 *    attachments added after a product exists, a different flow (Task 43's
 *    `FileUploadField`), not a grid-editable field.
 *  - `usedInAssemblies` (legacy's server-computed "which assemblies use
 *    this component" readonly column, from `Products.gs#getProductUsageMap_`)
 *    has no equivalent endpoint in this backend — dropped, flagged here as
 *    a possible future addition rather than reproduced with a workaround.
 *
 * `qty` keeps its legacy `special: 'qty'` routing: editing it does NOT
 * PATCH `Product.qty` directly (the atomic stock ledger rule — see
 * backend/README.md — applies here exactly as it did to Excel import).
 * `app/(app)/catalog/grid/page.tsx` posts an `ADJUST` stock movement for
 * the delta instead, same mechanism as legacy's `adjustStock` call.
 */
export type GridColumnType = 'text' | 'number' | 'unit';

export interface GridColumn {
  key: keyof Product;
  labelKey: string; // catalog.* i18n key, reused from the existing product-form/list translations
  type: GridColumnType;
  basic?: boolean;
  filterable?: boolean;
  special?: 'qty';
}

export const PRODUCT_GRID_COLUMNS: GridColumn[] = [
  { key: 'article', labelKey: 'article', type: 'text' },
  { key: 'code', labelKey: 'code', type: 'text' },
  { key: 'name', labelKey: 'name', type: 'text', basic: true },
  { key: 'description', labelKey: 'description', type: 'text' },
  { key: 'category', labelKey: 'category', type: 'text', basic: true, filterable: true },
  { key: 'productGroup', labelKey: 'productGroup', type: 'text', filterable: true },
  { key: 'family', labelKey: 'family', type: 'text', filterable: true },
  { key: 'type', labelKey: 'type', type: 'text', filterable: true },
  { key: 'kind', labelKey: 'kind', type: 'text', filterable: true },
  { key: 'productLine', labelKey: 'productLine', type: 'text' },
  { key: 'barcode', labelKey: 'barcode', type: 'text' },
  { key: 'unitId', labelKey: 'unit', type: 'unit', basic: true },
  { key: 'unitsPerPackage', labelKey: 'unitsPerPackage', type: 'number' },
  { key: 'cell', labelKey: 'cell', type: 'text', basic: true },
  { key: 'qty', labelKey: 'qty', type: 'number', basic: true, special: 'qty' },
  { key: 'minQty', labelKey: 'minQty', type: 'number', basic: true },
  { key: 'localPriceExclVat', labelKey: 'localPriceExclVat', type: 'number', basic: true },
  { key: 'localPriceInclVat', labelKey: 'localPriceInclVat', type: 'number' },
  { key: 'germanPriceExclVat', labelKey: 'germanPriceExclVat', type: 'number' },
  { key: 'germanPriceInclVat', labelKey: 'germanPriceInclVat', type: 'number' },
  { key: 'sellPriceEur', labelKey: 'sellPrice', type: 'number', basic: true },
  { key: 'weightPerUnitKg', labelKey: 'weightPerUnitKg', type: 'number' },
  { key: 'warrantyMonths', labelKey: 'warrantyMonths', type: 'text' },
  { key: 'status', labelKey: 'status', type: 'text', filterable: true },
  { key: 'manufacturer', labelKey: 'manufacturer', type: 'text', filterable: true },
  { key: 'manufacturerCode', labelKey: 'manufacturerCode', type: 'text' },
  { key: 'countryOfOrigin', labelKey: 'countryOfOrigin', type: 'text', filterable: true },
  { key: 'priceListRef', labelKey: 'priceListRef', type: 'text' },
  { key: 'note', labelKey: 'note', type: 'text' },
];

export const FILTERABLE_COLUMNS = PRODUCT_GRID_COLUMNS.filter((c) => c.filterable);

/**
 * Pure — same AND-across-all-active-filters, strict-equality semantics as
 * legacy's `applySsFilters_`, applied client-side against an already-loaded
 * product list (this backend has no `getFilterOptions`-equivalent endpoint,
 * so both the filter option lists AND the filtering itself are computed
 * client-side here, unlike legacy which fetched options from the server but
 * still filtered client-side).
 */
export function filterProductsByFieldValues(
  products: Product[],
  filters: Partial<Record<string, string>>,
): Product[] {
  const activeKeys = Object.keys(filters).filter((k) => filters[k]);
  if (activeKeys.length === 0) return products;
  return products.filter((p) => activeKeys.every((key) => (p as any)[key] === filters[key]));
}

/** Pure — distinct, sorted, non-empty values for one field across the loaded product set (this grid's stand-in for legacy's server-side getFilterOptions). */
export function distinctFieldValues(products: Product[], key: string): string[] {
  const values = new Set<string>();
  for (const p of products) {
    const v = (p as any)[key];
    if (v) values.add(String(v));
  }
  return [...values].sort((a, b) => a.localeCompare(b));
}
