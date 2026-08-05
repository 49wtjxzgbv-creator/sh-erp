import { parsePickListJson, resolvePickListItems, parseStageHistoryJson, parseAssignedWorkersJson } from './production-json';

describe('parsePickListJson', () => {
  it('parses a regular product line', () => {
    const raw = JSON.stringify([{ article: 'ART-1', code: 'C', name: 'Bolt', cell: 'A1', unit: 'шт', qty: 5, photoUrl: '', priceEur: 1.5, lineTotalEur: 7.5 }]);
    const { items, warnings } = parsePickListJson(raw);
    expect(warnings).toEqual([]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ article: 'ART-1', qty: '5', unitPriceEur: '1.5', lineTotalEur: '7.5', isSubAssemblyLine: false });
  });

  it('parses a sub-assembly consumption line (has consumedSerials)', () => {
    const raw = JSON.stringify([{ article: 'SUB-1', code: '', name: 'Sub', cell: '', unit: 'шт', qty: 2, photoUrl: '', priceEur: 10, lineTotalEur: 20, consumedSerials: ['SN-1', 'SN-2'] }]);
    const { items } = parsePickListJson(raw);
    expect(items[0].isSubAssemblyLine).toBe(true);
    expect(items[0].consumedSerialsRaw).toEqual(['SN-1', 'SN-2']);
  });

  it('treats blank cell as empty with no warnings', () => {
    expect(parsePickListJson(null)).toEqual({ items: [], warnings: [] });
  });

  it('warns on malformed JSON', () => {
    const { items, warnings } = parsePickListJson('{broken');
    expect(items).toEqual([]);
    expect(warnings[0]).toContain('not valid JSON');
  });
});

describe('resolvePickListItems', () => {
  const productIdByArticle = new Map([['ART-1', 'product-uuid-1']]);
  const finishedGoodIdBySerial = new Map([['SN-1', 'fg-uuid-1']]);

  it('resolves a regular line\'s article to a productId', () => {
    const { items } = parsePickListJson(JSON.stringify([{ article: 'ART-1', name: 'Bolt', qty: 3 }]));
    const { resolved, warnings } = resolvePickListItems(items, productIdByArticle, finishedGoodIdBySerial, 'PO x');
    expect(resolved[0].productId).toBe('product-uuid-1');
    expect(resolved[0].description).toBe('ART-1 Bolt');
    expect(warnings).toEqual([]);
  });

  it('warns and leaves productId null when the article does not resolve', () => {
    const { items } = parsePickListJson(JSON.stringify([{ article: 'GHOST', name: 'X', qty: 1 }]));
    const { resolved, warnings } = resolvePickListItems(items, productIdByArticle, finishedGoodIdBySerial, 'PO x');
    expect(resolved[0].productId).toBeNull();
    expect(warnings.some((w) => w.includes('GHOST'))).toBe(true);
  });

  it('resolves consumed serials to finished-good ids, warning on unresolved ones', () => {
    const { items } = parsePickListJson(JSON.stringify([{ article: 'SUB', name: 'Sub', qty: 1, consumedSerials: ['SN-1', 'SN-GHOST'] }]));
    const { resolved, warnings } = resolvePickListItems(items, productIdByArticle, finishedGoodIdBySerial, 'PO x');
    expect(resolved[0].consumedFinishedGoodIds).toEqual(['fg-uuid-1']);
    expect(resolved[0].productId).toBeNull(); // sub-assembly lines never get a productId
    expect(warnings.some((w) => w.includes('consumed serial'))).toBe(true);
  });
});

describe('parseStageHistoryJson', () => {
  it('parses stage events', () => {
    const raw = JSON.stringify([{ stageIndex: 2, user: 'ivan', at: '2025-03-01 09:00:00' }]);
    const { events, warnings } = parseStageHistoryJson(raw);
    expect(warnings).toEqual([]);
    expect(events[0].stageIndex).toBe(2);
    expect(events[0].legacyUserLogin).toBe('ivan');
    expect(events[0].createdAt).toBeInstanceOf(Date);
  });

  it('handles blank input', () => {
    expect(parseStageHistoryJson('')).toEqual({ events: [], warnings: [] });
  });
});

describe('parseAssignedWorkersJson', () => {
  it('parses worker assignments', () => {
    const raw = JSON.stringify([{ employeeId: 'emp-1', percent: 60 }, { employeeId: 'emp-2', percent: 40 }]);
    const { workers, warnings } = parseAssignedWorkersJson(raw);
    expect(warnings).toEqual([]);
    expect(workers).toEqual([
      { legacyEmployeeId: 'emp-1', percent: '60' },
      { legacyEmployeeId: 'emp-2', percent: '40' },
    ]);
  });
});
