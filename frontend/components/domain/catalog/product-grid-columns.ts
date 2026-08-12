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
 *  - `photoUrl` as a grid-editable text field is dropped — `Product` has no
 *    photo column in this backend at all; photos are `FileAsset`
 *    attachments added after a product exists, a different flow (Task 43's
 *    `FileUploadField`). A read-only photo thumbnail is still shown in the
 *    grid (fixed leading column, not part of `PRODUCT_GRID_COLUMNS`/the
 *    column-visibility toggle, same treatment as the row-select checkbox
 *    column), matching the photo column already on the plain Catalog list.
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
  /**
   * Inline-edit input width in px. Table layout is `auto`, and a plain
   * `w-full` input inside an auto-layout table cell collapses to the
   * browser's tiny default form-control size rather than the cell's real
   * content width — the cause of values like the product name reading as
   * visually clipped. An explicit per-column width (generous enough for
   * typical real values, not just the header label) fixes that; the table
   * itself still scrolls horizontally (`Table`'s own `overflow-auto`) if the
   * total exceeds the viewport, so nothing is ever cut off, just scrollable.
   */
  width: number;
}

export const PRODUCT_GRID_COLUMNS: GridColumn[] = [
  { key: 'article', labelKey: 'article', type: 'text', basic: true, width: 130 },
  { key: 'code', labelKey: 'code', type: 'text', width: 110 },
  { key: 'name', labelKey: 'name', type: 'text', basic: true, width: 340 },
  { key: 'description', labelKey: 'description', type: 'text', width: 260 },
  { key: 'category', labelKey: 'category', type: 'text', basic: true, filterable: true, width: 150 },
  { key: 'productGroup', labelKey: 'productGroup', type: 'text', filterable: true, width: 150 },
  { key: 'family', labelKey: 'family', type: 'text', filterable: true, width: 130 },
  { key: 'type', labelKey: 'type', type: 'text', filterable: true, width: 110 },
  { key: 'kind', labelKey: 'kind', type: 'text', filterable: true, width: 110 },
  { key: 'productLine', labelKey: 'productLine', type: 'text', width: 150 },
  { key: 'barcode', labelKey: 'barcode', type: 'text', width: 140 },
  { key: 'unitId', labelKey: 'unit', type: 'unit', basic: true, width: 110 },
  { key: 'unitsPerPackage', labelKey: 'unitsPerPackage', type: 'number', width: 90 },
  { key: 'cell', labelKey: 'cell', type: 'text', basic: true, width: 120 },
  { key: 'qty', labelKey: 'qty', type: 'number', basic: true, special: 'qty', width: 90 },
  { key: 'minQty', labelKey: 'minQty', type: 'number', basic: true, width: 100 },
  { key: 'localPriceExclVat', labelKey: 'localPriceExclVat', type: 'number', basic: true, width: 140 },
  { key: 'localPriceInclVat', labelKey: 'localPriceInclVat', type: 'number', width: 140 },
  { key: 'germanPriceExclVat', labelKey: 'germanPriceExclVat', type: 'number', width: 150 },
  { key: 'germanPriceInclVat', labelKey: 'germanPriceInclVat', type: 'number', width: 150 },
  { key: 'sellPriceEur', labelKey: 'sellPrice', type: 'number', basic: true, width: 130 },
  { key: 'weightPerUnitKg', labelKey: 'weightPerUnitKg', type: 'number', width: 120 },
  { key: 'warrantyMonths', labelKey: 'warrantyMonths', type: 'text', width: 110 },
  { key: 'status', labelKey: 'status', type: 'text', filterable: true, width: 120 },
  { key: 'manufacturer', labelKey: 'manufacturer', type: 'text', filterable: true, width: 150 },
  { key: 'manufacturerCode', labelKey: 'manufacturerCode', type: 'text', width: 130 },
  { key: 'countryOfOrigin', labelKey: 'countryOfOrigin', type: 'text', filterable: true, width: 150 },
  { key: 'priceListRef', labelKey: 'priceListRef', type: 'text', width: 150 },
  { key: 'note', labelKey: 'note', type: 'text', width: 220 },
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
