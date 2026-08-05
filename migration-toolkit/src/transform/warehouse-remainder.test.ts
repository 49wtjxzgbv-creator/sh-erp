import { computeDefaultWarehouseRemainder } from './warehouse-remainder';

describe('computeDefaultWarehouseRemainder', () => {
  it('computes the remainder as total qty minus the sum of named warehouses', () => {
    const result = computeDefaultWarehouseRemainder('100', ['20', '30']);
    expect(result).toEqual({ remainder: '50', isNegative: false });
  });

  it('treats no named warehouses as the whole qty going to the default warehouse', () => {
    expect(computeDefaultWarehouseRemainder('42', [])).toEqual({ remainder: '42', isNegative: false });
  });

  it('flags (not clamps) a negative remainder — a real source data-integrity problem', () => {
    const result = computeDefaultWarehouseRemainder('10', ['15']);
    expect(result.remainder).toBe('-5');
    expect(result.isNegative).toBe(true);
  });

  it('treats an unparseable product qty as 0, not a thrown error', () => {
    expect(computeDefaultWarehouseRemainder('not a number', ['5'])).toEqual({ remainder: '-5', isNegative: true });
  });

  it('a zero-qty product with no named-warehouse stock is exactly zero, not negative', () => {
    expect(computeDefaultWarehouseRemainder('0', [])).toEqual({ remainder: '0', isNegative: false });
  });
});
