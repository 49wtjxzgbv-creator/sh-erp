import { SHEET_SCHEMAS, ALL_SHEET_KEYS, PRODUCT_LEGACY_COLUMN_ALIASES } from './sheet-schemas';

describe('SHEET_SCHEMAS', () => {
  it('covers exactly the 26 migratable sheets (27 legacy sheets minus TelegramUsers, per Phase 0/Phase 3 §5)', () => {
    expect(ALL_SHEET_KEYS).toHaveLength(26);
  });

  it('every schema has a non-empty tabName and at least one header', () => {
    for (const key of ALL_SHEET_KEYS) {
      const schema = SHEET_SCHEMAS[key];
      expect(schema.tabName.length).toBeGreaterThan(0);
      expect(schema.headers.length).toBeGreaterThan(0);
    }
  });

  it('every schema has no duplicate headers within itself', () => {
    for (const key of ALL_SHEET_KEYS) {
      const { headers } = SHEET_SCHEMAS[key];
      expect(new Set(headers).size).toBe(headers.length);
    }
  });

  it('no two schemas share the same tab name', () => {
    const tabNames = ALL_SHEET_KEYS.map((k) => SHEET_SCHEMAS[k].tabName);
    expect(new Set(tabNames).size).toBe(tabNames.length);
  });

  it('every declared jsonBlobColumn is actually one of that sheet\'s headers', () => {
    for (const key of ALL_SHEET_KEYS) {
      const schema = SHEET_SCHEMAS[key];
      for (const blobCol of schema.jsonBlobColumns ?? []) {
        expect(schema.headers).toContain(blobCol);
      }
    }
  });

  it('exactly 3 sheets carry JSON blob columns, totaling 5 blob columns (Phase 3 §4)', () => {
    const withBlobs = ALL_SHEET_KEYS.filter((k) => (SHEET_SCHEMAS[k].jsonBlobColumns?.length ?? 0) > 0);
    expect(withBlobs.sort()).toEqual(['assemblyVersions', 'productionOrders', 'qcChecks'].sort());
    const totalBlobCols = withBlobs.reduce((sum, k) => sum + (SHEET_SCHEMAS[k].jsonBlobColumns?.length ?? 0), 0);
    expect(totalBlobCols).toBe(5);
  });

  it('PRODUCT_LEGACY_COLUMN_ALIASES only maps to headers that exist on the canonical Products schema', () => {
    for (const canonical of Object.keys(PRODUCT_LEGACY_COLUMN_ALIASES)) {
      expect(SHEET_SCHEMAS.products.headers).toContain(canonical);
    }
  });
});
