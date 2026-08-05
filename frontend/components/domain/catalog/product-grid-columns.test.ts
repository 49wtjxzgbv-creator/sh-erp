import { filterProductsByFieldValues, distinctFieldValues, PRODUCT_GRID_COLUMNS } from './product-grid-columns';
import type { Product } from '@/lib/api-client/catalog';

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1', companyId: 'c1', article: 'ABC-1', code: null, name: 'Гвинт', description: null,
    category: 'Кріплення', productGroup: null, family: null, type: null, kind: null, productLine: null,
    barcode: null, unitId: 'u1', unitsPerPackage: null, cell: null, qty: '10', minQty: '0',
    localPriceExclVat: null, localPriceInclVat: null, germanPriceExclVat: null, germanPriceInclVat: null,
    sellPriceEur: null, weightPerUnitKg: null, warrantyMonths: null, status: 'active', manufacturer: null,
    manufacturerCode: null, countryOfOrigin: null, priceListRef: null, note: null, defaultSupplierId: null,
    createdAt: '2026-01-01', updatedAt: '2026-01-01', deletedAt: null,
    ...overrides,
  };
}

describe('filterProductsByFieldValues', () => {
  const products = [
    makeProduct({ id: 'p1', category: 'Кріплення', status: 'active' }),
    makeProduct({ id: 'p2', category: 'Кріплення', status: 'archived' }),
    makeProduct({ id: 'p3', category: 'Інструмент', status: 'active' }),
  ];

  it('returns everything when no filters are active', () => {
    expect(filterProductsByFieldValues(products, {})).toHaveLength(3);
  });

  it('applies a single filter', () => {
    const result = filterProductsByFieldValues(products, { category: 'Кріплення' });
    expect(result.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('ANDs multiple active filters, not ORs them', () => {
    const result = filterProductsByFieldValues(products, { category: 'Кріплення', status: 'active' });
    expect(result.map((p) => p.id)).toEqual(['p1']);
  });

  it('ignores empty-string filter values (treated as "not set", same as legacy)', () => {
    const result = filterProductsByFieldValues(products, { category: 'Кріплення', status: '' });
    expect(result.map((p) => p.id)).toEqual(['p1', 'p2']);
  });
});

describe('distinctFieldValues', () => {
  it('returns sorted, de-duplicated, non-empty values', () => {
    const products = [
      makeProduct({ manufacturer: 'Bosch' }),
      makeProduct({ manufacturer: 'Makita' }),
      makeProduct({ manufacturer: 'Bosch' }),
      makeProduct({ manufacturer: null }),
    ];
    expect(distinctFieldValues(products, 'manufacturer')).toEqual(['Bosch', 'Makita']);
  });

  it('returns an empty array when no product has the field set', () => {
    expect(distinctFieldValues([makeProduct({ manufacturer: null })], 'manufacturer')).toEqual([]);
  });
});

describe('PRODUCT_GRID_COLUMNS', () => {
  it('has exactly one qty column marked special: "qty" — routed through StockService, never a plain PATCH', () => {
    const qtyColumns = PRODUCT_GRID_COLUMNS.filter((c) => c.special === 'qty');
    expect(qtyColumns).toHaveLength(1);
    expect(qtyColumns[0].key).toBe('qty');
  });

  it('has no photoUrl or usedInAssemblies column — dropped, see file header comment', () => {
    const keys = PRODUCT_GRID_COLUMNS.map((c) => c.key);
    expect(keys).not.toContain('photoUrl');
    expect(keys).not.toContain('usedInAssemblies');
  });

  it('marks unit as a select-backed column, not free text (schema now requires a real CompanyUnit FK)', () => {
    const unitColumn = PRODUCT_GRID_COLUMNS.find((c) => c.key === 'unitId');
    expect(unitColumn?.type).toBe('unit');
  });
});
