import { expandLabelCopies, type SelectedLabel } from './product-labels-dialog';

const label = (overrides: Partial<SelectedLabel> = {}): SelectedLabel => ({
  productId: 'p1',
  article: 'ABC-1',
  code: null,
  name: 'Гвинт M6',
  cell: null,
  copies: 1,
  ...overrides,
});

describe('expandLabelCopies', () => {
  it('repeats a product once per requested copy', () => {
    const result = expandLabelCopies([label({ copies: 3 })]);
    expect(result).toHaveLength(3);
    expect(result.every((r) => r.productId === 'p1')).toBe(true);
  });

  it('flattens multiple products, each with its own copy count', () => {
    const result = expandLabelCopies([
      label({ productId: 'p1', copies: 2 }),
      label({ productId: 'p2', copies: 1 }),
    ]);
    expect(result.map((r) => r.productId)).toEqual(['p1', 'p1', 'p2']);
  });

  it('returns an empty list for an empty selection', () => {
    expect(expandLabelCopies([])).toEqual([]);
  });

  it('produces no labels for a product with 0 copies (edge case, UI enforces min 1 but the helper itself should not assume that)', () => {
    const result = expandLabelCopies([label({ copies: 0 })]);
    expect(result).toEqual([]);
  });
});
