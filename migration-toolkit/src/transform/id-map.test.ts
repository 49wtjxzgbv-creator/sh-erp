import { LegacyIdMap } from './id-map';

describe('LegacyIdMap', () => {
  it('resolves a legacyId to its new UUID within a namespace', () => {
    const map = new LegacyIdMap();
    map.set('supplier', 'sup-1', 'uuid-a');
    expect(map.get('supplier', 'sup-1')).toBe('uuid-a');
    expect(map.has('supplier', 'sup-1')).toBe(true);
  });

  it('keeps namespaces independent — same legacyId in two namespaces resolves differently', () => {
    const map = new LegacyIdMap();
    map.set('supplier', 'abc123', 'uuid-supplier');
    map.set('employee', 'abc123', 'uuid-employee');
    expect(map.get('supplier', 'abc123')).toBe('uuid-supplier');
    expect(map.get('employee', 'abc123')).toBe('uuid-employee');
  });

  it('returns undefined for an unknown legacyId, null, or empty string, without throwing', () => {
    const map = new LegacyIdMap();
    expect(map.get('supplier', 'nope')).toBeUndefined();
    expect(map.get('supplier', null)).toBeUndefined();
    expect(map.get('supplier', undefined)).toBeUndefined();
    expect(map.get('supplier', '')).toBeUndefined();
    expect(map.has('supplier', 'nope')).toBe(false);
  });

  it('ignores a set() call with an empty legacyId (never pollutes the namespace)', () => {
    const map = new LegacyIdMap();
    map.set('supplier', '', 'uuid-x');
    expect(map.size('supplier')).toBe(0);
  });

  it('size() reflects the number of distinct legacyIds recorded', () => {
    const map = new LegacyIdMap();
    map.set('product', 'p1', 'u1');
    map.set('product', 'p2', 'u2');
    expect(map.size('product')).toBe(2);
    expect(map.size('unused-namespace')).toBe(0);
  });
});
