import { parseChecklistJson } from './qc-json';

describe('parseChecklistJson', () => {
  it('parses a real checklist result array', () => {
    const raw = JSON.stringify([{ item: 'Зовнішній вигляд', passed: true }, { item: 'Розміри', passed: false }]);
    const { results, warnings } = parseChecklistJson(raw);
    expect(warnings).toEqual([]);
    expect(results).toEqual([
      { itemName: 'Зовнішній вигляд', passed: true },
      { itemName: 'Розміри', passed: false },
    ]);
  });

  it('treats a non-true passed value as false, never throws', () => {
    const raw = JSON.stringify([{ item: 'X', passed: 'yes' }]);
    const { results } = parseChecklistJson(raw);
    expect(results[0].passed).toBe(false);
  });

  it('returns empty for blank input', () => {
    expect(parseChecklistJson(null)).toEqual({ results: [], warnings: [] });
    expect(parseChecklistJson('')).toEqual({ results: [], warnings: [] });
  });

  it('warns on malformed JSON without throwing', () => {
    const { results, warnings } = parseChecklistJson('not json{{');
    expect(results).toEqual([]);
    expect(warnings[0]).toContain('not valid JSON');
  });
});
