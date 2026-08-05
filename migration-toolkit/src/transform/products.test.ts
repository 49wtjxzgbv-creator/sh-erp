import { transformProductRow, type ProductTransformContext } from './products';
import type { RawRow } from '../types';

const baseCtx: ProductTransformContext = {
  unitIdByName: new Map([['шт', 'unit-1'], ['кг', 'unit-2']]),
  supplierIdByLegacyId: new Map([['sup-1', 'supplier-uuid-1']]),
};

function row(overrides: Partial<RawRow> = {}): RawRow {
  return {
    ID: 'prod-1',
    Article: 'ART-001',
    Code: 'C1',
    Name: 'Test Product',
    Unit: 'шт',
    Qty: 10,
    MinQty: 2,
    LocalPriceExclVat: 100,
    DefaultSupplierId: '',
    CreatedAt: '2025-01-01 10:00:00',
    UpdatedAt: '2025-01-02 10:00:00',
    ...overrides,
  };
}

describe('transformProductRow', () => {
  it('maps a well-formed row cleanly with no warnings', () => {
    const { record, warnings } = transformProductRow(row(), baseCtx);
    expect(record.legacyId).toBe('prod-1');
    expect(record.article).toBe('ART-001');
    expect(record.name).toBe('Test Product');
    expect(record.unitId).toBe('unit-1');
    expect(record.qty).toBe('10');
    expect(record.minQty).toBe('2');
    expect(record.localPriceExclVat).toBe('100');
    expect(warnings).toEqual([]);
  });

  it('resolves DefaultSupplierId via the legacyId map', () => {
    const { record, warnings } = transformProductRow(row({ DefaultSupplierId: 'sup-1' }), baseCtx);
    expect(record.defaultSupplierId).toBe('supplier-uuid-1');
    expect(warnings).toEqual([]);
  });

  it('warns and leaves defaultSupplierId undefined when the legacy supplier id does not resolve', () => {
    const { record, warnings } = transformProductRow(row({ DefaultSupplierId: 'sup-ghost' }), baseCtx);
    expect(record.defaultSupplierId).toBeUndefined();
    expect(warnings.some((w) => w.includes('sup-ghost'))).toBe(true);
  });

  it('warns and defaults qty to "0" for a blank Qty cell', () => {
    const { record, warnings } = transformProductRow(row({ Qty: '' }), baseCtx);
    expect(record.qty).toBe('0');
    expect(warnings.some((w) => w.includes('blank Qty'))).toBe(true);
  });

  it('warns and leaves unitId empty when the Unit does not resolve to any CompanyUnit', () => {
    const { record, warnings } = transformProductRow(row({ Unit: 'палета' }), baseCtx);
    expect(record.unitId).toBe('');
    expect(warnings.some((w) => w.includes('Unit'))).toBe(true);
  });

  it('warns on a blank Article (would collide on the unique key)', () => {
    const { warnings } = transformProductRow(row({ Article: '' }), baseCtx);
    expect(warnings.some((w) => w.includes('blank Article'))).toBe(true);
  });

  it('falls back to Article, then a legacyId placeholder, when Name is blank', () => {
    const { record: withArticle } = transformProductRow(row({ Name: '' }), baseCtx);
    expect(withArticle.name).toBe('ART-001');

    const { record: withNeither } = transformProductRow(row({ Name: '', Article: '' }), baseCtx);
    expect(withNeither.name).toContain('prod-1');
  });

  it('drops PhotoUrl/QrUrl entirely (no such fields on the target record)', () => {
    const { record } = transformProductRow(row({ PhotoUrl: 'https://x', QrUrl: 'https://y' } as any), baseCtx);
    expect(record).not.toHaveProperty('photoUrl');
    expect(record).not.toHaveProperty('qrUrl');
  });
});
