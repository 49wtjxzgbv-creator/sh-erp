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
    });
  });

  it('leaves match fields empty when nothing matches', () => {
    const line = toMatchedBomLine('Невідома деталь', 2, null, products);
    expect(line.matched).toBe(false);
    expect(line.productId).toBe('');
    expect(line.article).toBe('');
    expect(line.matchedName).toBe('');
  });
});
