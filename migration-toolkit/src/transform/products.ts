import type { RawRow } from '../types';
import { resolveUnitId } from './units';
import { parseDecimalString, parseDecimalStringOrZero, parseOptionalString, parseLegacyDate } from './parsing';

/**
 * Products.gs -> `products` table (Phase 4 design doc §2.2 step 4 — "the
 * largest single mapping... old columns map mostly 1:1 onto typed columns,
 * per 'preserve all business logic'"). Unlike the Excel import feature's
 * `product-field-synonyms.ts` (which has to fuzzy-match a human-edited
 * spreadsheet's arbitrary column names against a synonym dictionary), this
 * migration path reads directly from the canonical legacy header names in
 * `sheet-schemas.ts` — extract.ts already resolved those against the real
 * sheet, so transform can address fields by their exact legacy name with no
 * synonym matching needed.
 *
 * Two columns from `PRODUCT_HEADERS` are deliberately NOT mapped, disclosed
 * rather than silently dropped: `PhotoUrl` and `QrUrl` have no equivalent
 * column on the `Product` model in this backend (confirmed repeatedly
 * throughout this project's production-readiness pass — product photos are
 * a `FileAsset` row, not a URL string column). A real cutover that needs to
 * carry photos forward needs a separate, later pass that downloads each
 * legacy Drive file and re-uploads it as a `FileAsset` — out of scope for
 * this row-shape transform, and NOT silently done by transform assuming R2
 * access it doesn't have.
 */

export interface ProductTransformResult {
  record: {
    legacyId: string;
    article: string;
    code: string | null;
    name: string;
    description: string | null;
    category: string | null;
    productGroup: string | null;
    family: string | null;
    type: string | null;
    kind: string | null;
    productLine: string | null;
    barcode: string | null;
    unitId: string;
    unitsPerPackage: string | undefined;
    cell: string | null;
    qty: string;
    minQty: string;
    localPriceExclVat: string | undefined;
    localPriceInclVat: string | undefined;
    germanPriceExclVat: string | undefined;
    germanPriceInclVat: string | undefined;
    sellPriceEur: string | undefined;
    weightPerUnitKg: string | undefined;
    warrantyMonths: string | null;
    status: string | null;
    manufacturer: string | null;
    manufacturerCode: string | null;
    countryOfOrigin: string | null;
    priceListRef: string | null;
    note: string | null;
    defaultSupplierId: string | undefined;
    createdAt: Date | undefined;
    updatedAt: Date | undefined;
  };
  warnings: string[];
}

export interface ProductTransformContext {
  unitIdByName: ReadonlyMap<string, string>;
  /** Supplier legacyId -> new UUID (Products.gs has no supplier-name column, only nothing at all today — DefaultSupplierId is already a legacy row id, not a free-text name, so no name-matching is needed here, unlike PurchaseOrders.Supplier). */
  supplierIdByLegacyId: ReadonlyMap<string, string>;
}

export function transformProductRow(row: RawRow, ctx: ProductTransformContext): ProductTransformResult {
  const warnings: string[] = [];
  const legacyId = String(row.ID ?? '');
  const article = parseOptionalString(row.Article) ?? '';
  if (!article) warnings.push(`Product legacyId=${legacyId}: blank Article — this row's target ` +
    `'article' unique key will collide with any other row that also has a blank Article. Flag for manual review before load.`);

  const name = parseOptionalString(row.Name) ?? (article || `(unnamed, legacyId=${legacyId})`);

  const unitId = resolveUnitId(row.Unit, ctx.unitIdByName);
  if (!unitId) {
    warnings.push(`Product legacyId=${legacyId} article=${article}: Unit "${String(row.Unit ?? '')}" did not resolve to any CompanyUnit — this row cannot be loaded until its unit is resolved (required FK, decision 1).`);
  }

  const qty = parseDecimalStringOrZero(row.Qty);
  if (qty.wasBlank) warnings.push(`Product legacyId=${legacyId} article=${article}: blank Qty, defaulted to 0.`);
  const minQty = parseDecimalStringOrZero(row.MinQty);

  const legacySupplierId = parseOptionalString(row.DefaultSupplierId);
  const defaultSupplierId = legacySupplierId ? ctx.supplierIdByLegacyId.get(legacySupplierId) : undefined;
  if (legacySupplierId && !defaultSupplierId) {
    warnings.push(`Product legacyId=${legacyId} article=${article}: DefaultSupplierId "${legacySupplierId}" did not resolve to any migrated Supplier — left null rather than referencing a nonexistent row.`);
  }

  return {
    record: {
      legacyId,
      article,
      code: parseOptionalString(row.Code),
      name,
      description: parseOptionalString(row.Description),
      category: parseOptionalString(row.Category),
      productGroup: parseOptionalString(row.ProductGroup),
      family: parseOptionalString(row.Family),
      type: parseOptionalString(row.Type),
      kind: parseOptionalString(row.Kind),
      productLine: parseOptionalString(row.ProductLine),
      barcode: parseOptionalString(row.Barcode),
      unitId: unitId ?? '', // caller (transform orchestrator) must exclude rows with an empty unitId from load — see warnings
      unitsPerPackage: parseDecimalString(row.UnitsPerPackage),
      cell: parseOptionalString(row.Cell),
      qty: qty.value,
      minQty: minQty.value,
      localPriceExclVat: parseDecimalString(row.LocalPriceExclVat),
      localPriceInclVat: parseDecimalString(row.LocalPriceInclVat),
      germanPriceExclVat: parseDecimalString(row.GermanPriceExclVat),
      germanPriceInclVat: parseDecimalString(row.GermanPriceInclVat),
      sellPriceEur: parseDecimalString(row.SellPriceEUR),
      weightPerUnitKg: parseDecimalString(row.WeightPerUnitKg),
      warrantyMonths: parseOptionalString(row.WarrantyMonths),
      status: parseOptionalString(row.Status),
      manufacturer: parseOptionalString(row.Manufacturer),
      manufacturerCode: parseOptionalString(row.ManufacturerCode),
      countryOfOrigin: parseOptionalString(row.CountryOfOrigin),
      priceListRef: parseOptionalString(row.PriceListRef),
      note: parseOptionalString(row.Note),
      defaultSupplierId,
      createdAt: parseLegacyDate(row.CreatedAt),
      updatedAt: parseLegacyDate(row.UpdatedAt),
    },
    warnings,
  };
}
