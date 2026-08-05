import { computeQtyAfterSeries } from './stock-movement-balance';

describe('computeQtyAfterSeries', () => {
  it('reconstructs qtyAfter backward from the known final qty for a single product', () => {
    // History: +10 (RECEIVE), -3 (ISSUE), +2 (ADJUST) -> final qty 9
    const movements = [
      { id: 'm1', productId: 'p1', qtyDelta: '10' },
      { id: 'm2', productId: 'p1', qtyDelta: '-3' },
      { id: 'm3', productId: 'p1', qtyDelta: '2' },
    ];
    const result = computeQtyAfterSeries(movements, new Map([['p1', '9']]));
    expect(result.get('m3')).toBe('9'); // final
    expect(result.get('m2')).toBe('7'); // 9 - 2
    expect(result.get('m1')).toBe('10'); // 7 - (-3)
  });

  it('handles multiple products independently, preserving each product\'s own chronological order', () => {
    const movements = [
      { id: 'a1', productId: 'A', qtyDelta: '5' },
      { id: 'b1', productId: 'B', qtyDelta: '100' },
      { id: 'a2', productId: 'A', qtyDelta: '-2' },
      { id: 'b2', productId: 'B', qtyDelta: '-50' },
    ];
    const result = computeQtyAfterSeries(movements, new Map([['A', '3'], ['B', '50']]));
    expect(result.get('a2')).toBe('3');
    expect(result.get('a1')).toBe('5');
    expect(result.get('b2')).toBe('50');
    expect(result.get('b1')).toBe('100');
  });

  it('omits movements for a product with no known final qty, rather than guessing', () => {
    const movements = [{ id: 'm1', productId: 'ghost', qtyDelta: '10' }];
    const result = computeQtyAfterSeries(movements, new Map());
    expect(result.has('m1')).toBe(false);
  });

  it('a single movement\'s qtyAfter equals the final qty exactly', () => {
    const movements = [{ id: 'm1', productId: 'p1', qtyDelta: '7' }];
    const result = computeQtyAfterSeries(movements, new Map([['p1', '7']]));
    expect(result.get('m1')).toBe('7');
  });
});
