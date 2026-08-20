import { buildHeaderMap, mapRowToProduct, normalizeHeader } from './product-field-synonyms';

describe('normalizeHeader', () => {
  it('lowercases, strips quotes/periods/commas, collapses whitespace', () => {
    expect(normalizeHeader('  Ціна.наша, "з ПДВ"  ')).toBe('ціна наша з пдв');
  });
});

describe('buildHeaderMap', () => {
  it('matches Ukrainian, Russian, and English headers to the same field', () => {
    const map = buildHeaderMap(['Артикул', 'Название', 'Name']);
    expect(map['Артикул']).toBe('article');
    expect(map['Название']).toBe('name');
    expect(map['Name']).toBe('name');
  });

  it('prefers the longer, more specific synonym over a shorter one it partially contains', () => {
    // "ціна наша з пдв" must win over the shorter "ціна наша" it also matches.
    const map = buildHeaderMap(['Ціна наша з ПДВ (EUR)', 'Ціна наша без ПДВ']);
    expect(map['Ціна наша з ПДВ (EUR)']).toBe('localPriceInclVat');
    expect(map['Ціна наша без ПДВ']).toBe('localPriceExclVat');
  });

  it('ignores underscore-prefixed service columns', () => {
    const map = buildHeaderMap(['Артикул', '_photoBase64']);
    expect(map['_photoBase64']).toBeUndefined();
  });

  it('leaves unrecognized headers unmapped rather than guessing', () => {
    const map = buildHeaderMap(['Артикул', 'Якийсь незрозумілий стовпець']);
    expect(map['Якийсь незрозумілий стовпець']).toBeUndefined();
  });
});

describe('mapRowToProduct', () => {
  it('parses numeric fields, tolerating a comma decimal separator and stray currency symbols', () => {
    const headerMap = buildHeaderMap(['Артикул', 'Залишок']);
    const row = mapRowToProduct({ Артикул: 'ABC-1', Залишок: '1 234,5 шт' }, headerMap);
    expect(row.qty).toBeCloseTo(1234.5);
  });

  it('defaults an unparseable numeric field to 0 rather than NaN', () => {
    const headerMap = buildHeaderMap(['Залишок']);
    const row = mapRowToProduct({ Залишок: 'n/a' }, headerMap);
    expect(row.qty).toBe(0);
  });

  it('trims text fields', () => {
    const headerMap = buildHeaderMap(['Назва']);
    const row = mapRowToProduct({ Назва: '  Гвинт M6  ' }, headerMap);
    expect(row.name).toBe('Гвинт M6');
  });

  it('keeps photoUrl in the mapped row (though not as a Product column) — ProductsImportExportService reads it to fetch and attach a PRODUCT_PHOTO, see the file header comment', () => {
    const headerMap = buildHeaderMap(['Фото URL']);
    const row = mapRowToProduct({ 'Фото URL': 'https://example.com/x.jpg' }, headerMap);
    expect(row.photoUrl).toBe('https://example.com/x.jpg');
  });

  it('skips columns with no recognized header', () => {
    const headerMap = buildHeaderMap(['Артикул']);
    const row = mapRowToProduct({ Артикул: 'X', 'Random column': 'value' }, headerMap);
    expect(row).toEqual({ article: 'X' });
  });
});
