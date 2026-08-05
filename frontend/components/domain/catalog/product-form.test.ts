import { productToFormValues } from './product-form';
import type { Product } from '@/lib/api-client/catalog';

const baseProduct: Product = {
  id: 'p1',
  companyId: 'c1',
  article: 'ABC-1',
  code: null,
  name: 'Widget',
  description: null,
  category: null,
  productGroup: null,
  family: null,
  type: null,
  kind: null,
  productLine: null,
  barcode: null,
  unitId: 'u1',
  unitsPerPackage: '12.000',
  cell: null,
  qty: '5.000',
  minQty: '1.000',
  localPriceExclVat: null,
  localPriceInclVat: null,
  germanPriceExclVat: null,
  germanPriceInclVat: null,
  sellPriceEur: '9.990',
  weightPerUnitKg: null,
  warrantyMonths: null,
  status: null,
  manufacturer: null,
  manufacturerCode: null,
  countryOfOrigin: null,
  priceListRef: null,
  note: null,
  defaultSupplierId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
};

describe('productToFormValues', () => {
  it('returns an empty object when no product is given (create mode)', () => {
    expect(productToFormValues(undefined)).toEqual({});
  });

  it('converts Prisma Decimal strings to numbers for form fields', () => {
    const values = productToFormValues(baseProduct);
    expect(values.unitsPerPackage).toBe(12);
    expect(values.minQty).toBe(1);
    expect(values.sellPriceEur).toBe(9.99);
    // qty is intentionally NOT part of the editable form (ledger-derived) —
    // productToFormValues must not surface it as a settable field.
    expect(values).not.toHaveProperty('qty');
  });

  it('converts null optional fields to undefined so react-hook-form defaults render as empty inputs', () => {
    const values = productToFormValues(baseProduct);
    expect(values.code).toBeUndefined();
    expect(values.category).toBeUndefined();
  });
});
