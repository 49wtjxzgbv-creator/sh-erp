// Copied verbatim from migration-toolkit/src/transform/products.ts
// (2026-08-07) — see transform/types.ts's header comment for why this is a
// copy, not an import. PhotoUrl/QrUrl are still deliberately unmapped here
// too (Phase 3 of the migration plan handles photos as FileAsset rows via a
// separate pass, not as a column on Product).
import type { RawRow } from './types';
import { resolveUnitId } from './units';
import { parseDecimalString, parseDecimalStringOrZero, parseOptionalString, parseLegacyDate } from './parsing';

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
    warnings.push(`Product legacyId=${legacyId} article=${article}: Unit "${String(row.Unit ?? '')}" did not resolve to any CompanyUnit — this row cannot be loaded until its unit is resolved (required FK).`);
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
      unitId: unitId ?? '', // caller must exclude rows with an empty unitId from load — see warnings
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
