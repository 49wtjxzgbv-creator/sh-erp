import { normalizeUnitName, collectRequiredUnitNames, planUnitCreation, resolveUnitId, SEED_UNIT_NAMES } from './units';

describe('normalizeUnitName', () => {
  it('trims whitespace and returns the string', () => {
    expect(normalizeUnitName('  шт  ')).toBe('шт');
  });
  it('returns null for blank, non-string, or whitespace-only input', () => {
    expect(normalizeUnitName('')).toBeNull();
    expect(normalizeUnitName('   ')).toBeNull();
    expect(normalizeUnitName(null)).toBeNull();
    expect(normalizeUnitName(undefined)).toBeNull();
    expect(normalizeUnitName(42)).toBeNull();
  });
  it('does not case-fold (case-sensitive by design — see header comment)', () => {
    expect(normalizeUnitName('Шт')).toBe('Шт');
    expect(normalizeUnitName('Шт')).not.toBe('шт');
  });
});

describe('collectRequiredUnitNames', () => {
  it('returns distinct unit names in first-seen order', () => {
    const rows = [{ Unit: 'шт' }, { Unit: 'кг' }, { Unit: 'шт' }, { Unit: 'рулон' }];
    expect(collectRequiredUnitNames(rows)).toEqual(['шт', 'кг', 'рулон']);
  });
  it('ignores blank/missing Unit cells', () => {
    const rows = [{ Unit: 'шт' }, { Unit: '' }, { Unit: null }, {}];
    expect(collectRequiredUnitNames(rows)).toEqual(['шт']);
  });
  it('returns an empty array for no rows', () => {
    expect(collectRequiredUnitNames([])).toEqual([]);
  });
});

describe('planUnitCreation', () => {
  it('partitions seeded vs ad hoc unit names', () => {
    const plan = planUnitCreation(['шт', 'ящик', 'кг', 'палета']);
    expect(plan.seeded).toEqual(['шт', 'кг']);
    expect(plan.adHoc).toEqual(['ящик', 'палета']);
  });
  it('every SEED_UNIT_NAME is recognized as seeded, not ad hoc', () => {
    const plan = planUnitCreation([...SEED_UNIT_NAMES]);
    expect(plan.seeded).toEqual([...SEED_UNIT_NAMES]);
    expect(plan.adHoc).toEqual([]);
  });
  it('an empty input plans nothing', () => {
    expect(planUnitCreation([])).toEqual({ seeded: [], adHoc: [] });
  });
});

describe('resolveUnitId', () => {
  const idByName = new Map([['шт', 'unit-uuid-1'], ['ящик', 'unit-uuid-2']]);

  it('resolves a known unit name to its id', () => {
    expect(resolveUnitId('шт', idByName)).toBe('unit-uuid-1');
    expect(resolveUnitId(' ящик ', idByName)).toBe('unit-uuid-2');
  });
  it('returns undefined (not a throw) for an unknown or blank unit', () => {
    expect(resolveUnitId('невідомо', idByName)).toBeUndefined();
    expect(resolveUnitId('', idByName)).toBeUndefined();
    expect(resolveUnitId(null, idByName)).toBeUndefined();
  });
});
