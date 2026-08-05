import { normalizeComponentType, parseComponentsJson, transformAssemblyComponentRow, type ComponentResolutionContext } from './bom';

const ctx: ComponentResolutionContext = {
  productIdByLegacyId: new Map([['p1', 'product-uuid-1']]),
  assemblyIdByLegacyId: new Map([['a1', 'assembly-uuid-1']]),
  warehouseIdByLegacyId: new Map([['w1', 'warehouse-uuid-1']]),
};

describe('normalizeComponentType', () => {
  it('normalizes lowercase legacy strings', () => {
    expect(normalizeComponentType('product')).toBe('PRODUCT');
    expect(normalizeComponentType('assembly')).toBe('ASSEMBLY');
  });
  it('is case-insensitive', () => {
    expect(normalizeComponentType('Product')).toBe('PRODUCT');
  });
  it('returns undefined for unrecognized values', () => {
    expect(normalizeComponentType('widget')).toBeUndefined();
    expect(normalizeComponentType(null)).toBeUndefined();
  });
});

describe('parseComponentsJson', () => {
  it('parses and resolves a valid mixed blob', () => {
    const raw = JSON.stringify([
      { componentType: 'product', productId: 'p1', qty: 2, warehouseId: 'w1' },
      { componentType: 'assembly', subAssemblyId: 'a1', qty: 1 },
    ]);
    const { components, warnings } = parseComponentsJson(raw, ctx, 'AssemblyVersion x');
    expect(warnings).toEqual([]);
    expect(components).toHaveLength(2);
    expect(components[0]).toMatchObject({ componentType: 'PRODUCT', productId: 'product-uuid-1', warehouseId: 'warehouse-uuid-1', qtyPerUnit: '2' });
    expect(components[1]).toMatchObject({ componentType: 'ASSEMBLY', subAssemblyId: 'assembly-uuid-1', qtyPerUnit: '1' });
  });

  it('returns empty with no warnings for a blank cell', () => {
    expect(parseComponentsJson(null, ctx, 'x')).toEqual({ components: [], warnings: [] });
    expect(parseComponentsJson('', ctx, 'x')).toEqual({ components: [], warnings: [] });
  });

  it('warns and returns empty for malformed JSON', () => {
    const { components, warnings } = parseComponentsJson('not json', ctx, 'AssemblyVersion x');
    expect(components).toEqual([]);
    expect(warnings[0]).toContain('not valid JSON');
  });

  it('excludes a PRODUCT entry whose productId does not resolve, with a warning', () => {
    const raw = JSON.stringify([{ componentType: 'product', productId: 'ghost', qty: 1 }]);
    const { components, warnings } = parseComponentsJson(raw, ctx, 'AV x');
    expect(components).toEqual([]);
    expect(warnings[0]).toContain('did not resolve');
  });

  it('excludes an entry that is inconsistent (PRODUCT type but has a subAssemblyId too)', () => {
    const raw = JSON.stringify([{ componentType: 'product', productId: 'p1', subAssemblyId: 'a1', qty: 1 }]);
    const { components, warnings } = parseComponentsJson(raw, ctx, 'AV x');
    expect(components).toEqual([]);
    expect(warnings[0]).toContain('inconsistent');
  });

  it('excludes an unrecognized componentType with a warning, and keeps processing the rest of the array', () => {
    const raw = JSON.stringify([
      { componentType: 'bogus', qty: 1 },
      { componentType: 'product', productId: 'p1', qty: 3 },
    ]);
    const { components, warnings } = parseComponentsJson(raw, ctx, 'AV x');
    expect(components).toHaveLength(1);
    expect(components[0].qtyPerUnit).toBe('3');
    expect(warnings.some((w) => w.includes('unrecognized componentType'))).toBe(true);
  });
});

describe('transformAssemblyComponentRow', () => {
  it('maps a valid current-BOM row', () => {
    const { component, warnings } = transformAssemblyComponentRow(
      { ID: 'ac1', AssemblyID: 'a-parent', ProductID: 'p1', Qty: 5, WarehouseID: 'w1', ComponentType: 'product', SubAssemblyID: '' },
      ctx,
    );
    expect(warnings).toEqual([]);
    expect(component).toMatchObject({ componentType: 'PRODUCT', productId: 'product-uuid-1', qtyPerUnit: '5' });
  });

  it('returns undefined with a warning for an inconsistent row', () => {
    const { component, warnings } = transformAssemblyComponentRow(
      { ID: 'ac2', ComponentType: 'assembly', ProductID: '', SubAssemblyID: 'ghost', Qty: 1 },
      ctx,
    );
    expect(component).toBeUndefined();
    expect(warnings.length).toBeGreaterThan(0);
  });
});
