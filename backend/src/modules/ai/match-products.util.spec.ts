import { matchProductByName, toMatchedBomLine } from './match-products.util';

describe('matchProductByName', () => {
  const products = [
    { id: 'p1', article: 'A-001', name: 'Гвинт M6x20' } as any,
    { id: 'p2', article: 'A-002', name: 'Профіль алюмінієвий 40x40' } as any,
  ];

  it('matches on an exact, case-insensitive name', () => {
    expect(matchProductByName('гвинт m6x20', products)?.id).toBe('p1');
  });

  it('matches when the raw name is a substring of a real product name', () => {
    expect(matchProductByName('Профіль алюмінієвий', products)?.id).toBe('p2');
  });

  it('matches when a real product name is a substring of the raw name', () => {
    expect(matchProductByName('Профіль алюмінієвий 40x40, довжина 3м', products)?.id).toBe('p2');
  });

  it('does not match an unrelated short name (avoids 3-char-or-shorter false positives)', () => {
    expect(matchProductByName('гвн', products)).toBeUndefined();
  });

  it('returns undefined for no match', () => {
    expect(matchProductByName('Щось зовсім інше', products)).toBeUndefined();
  });

  // "не розпізнає все з чого складається ... покращити підбір — шукати і
  // за артикулом" (2026-11-18) — a STEP file's own part name is routinely
  // just the article number, with no real product name at all.
  it('matches on an exact article number, even though it is not the product name', () => {
    expect(matchProductByName('A-002', products)?.id).toBe('p2');
  });

  it('matches case-insensitively on article', () => {
    expect(matchProductByName('a-001', products)?.id).toBe('p1');
  });

  it('matches when the raw name is a substring of a real article', () => {
    const withLongArticle = [...products, { id: 'p3', article: '435981-REV2', name: '' } as any];
    expect(matchProductByName('435981', withLongArticle)?.id).toBe('p3');
  });

  it('prefers an exact article match over a substring name match', () => {
    // "A-001" also happens to read as a substring of this unrelated product's name.
    const ambiguous = [...products, { id: 'p3', article: 'X', name: 'Корпус A-0011 великий' } as any];
    expect(matchProductByName('A-001', ambiguous)?.id).toBe('p1');
  });
});

describe('toMatchedBomLine', () => {
  const products = [{ id: 'p1', article: 'A-001', name: 'Гвинт M6x20' } as any];

  it('fills in match fields when a product is found', () => {
    const line = toMatchedBomLine('Гвинт M6x20', 10, '20x6 мм', products);
    expect(line).toEqual({
      rawName: 'Гвинт M6x20',
      qty: 10,
      dimensions: '20x6 мм',
      matched: true,
      article: 'A-001',
      matchedName: 'Гвинт M6x20',
      productId: 'p1',
      lengthCm: null,
      widthCm: null,
      shapePolygon: null,
    });
  });

  it('carries structured lengthCm/widthCm through for the STEP path', () => {
    const line = toMatchedBomLine('Гвинт M6x20', 10, '1×1×1 см (за геометрією)', products, 1, 1);
    expect(line.lengthCm).toBe(1);
    expect(line.widthCm).toBe(1);
  });

  it('leaves match fields empty when nothing matches', () => {
    const line = toMatchedBomLine('Невідома деталь', 2, null, products);
    expect(line.matched).toBe(false);
    expect(line.productId).toBe('');
    expect(line.article).toBe('');
    expect(line.matchedName).toBe('');
  });
});
