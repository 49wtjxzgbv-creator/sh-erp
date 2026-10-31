// Plain CommonJS require — this child script isn't a TS module (spawned
// directly by node, copied as a raw asset by nest-cli.json), but its pure
// grouping/bounding-box logic is exported for exactly this: a real unit
// test without spawning a process or touching OCCT/WASM.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { computeBoundingBoxCm, collectLeaves, groupResultIntoBomLines } = require('./step-extract-bom-child.js');

describe('computeBoundingBoxCm', () => {
  it('converts a flat position array (mm) into a length/width/height bounding box in cm', () => {
    // A 100mm x 40mm x 20mm box: vertices at every combination of min/max per axis.
    const position = [0, 0, 0, 100, 40, 20, 50, 20, 10];
    expect(computeBoundingBoxCm(position)).toEqual({ lengthCm: 10, widthCm: 4, heightCm: 2 });
  });
});

describe('collectLeaves', () => {
  it('collects only nodes that own geometry, walking through assembly-only intermediates', () => {
    const root = {
      name: 'Assembly',
      meshes: [],
      children: [
        { name: 'Bolt', meshes: [0], children: [] },
        {
          name: 'Sub-assembly',
          meshes: [],
          children: [{ name: 'Bracket', meshes: [1], children: [] }],
        },
      ],
    };
    const out: any[] = [];
    collectLeaves(root, out);
    expect(out).toEqual([
      { name: 'Bolt', meshIndex: 0 },
      { name: 'Bracket', meshIndex: 1 },
    ]);
  });

  it('falls back to "(без назви)" for an unnamed node', () => {
    const out: any[] = [];
    collectLeaves({ name: '', meshes: [0], children: [] }, out);
    expect(out[0].name).toBe('(без назви)');
  });
});

describe('groupResultIntoBomLines', () => {
  const flatCube = { array: [0, 0, 0, 10, 10, 10] }; // trivial 1x1x1cm box

  it('groups repeated part names into one line with the correct qty (the real point of this feature — exact counts from the CAD structure)', () => {
    const result = {
      root: {
        name: 'Root',
        meshes: [],
        children: [
          { name: 'Гвинт M6x20', meshes: [0], children: [] },
          { name: 'Гвинт M6x20', meshes: [1], children: [] },
          { name: 'Гвинт M6x20', meshes: [2], children: [] },
          { name: 'Кутник', meshes: [3], children: [] },
        ],
      },
      meshes: [
        { attributes: { position: flatCube } },
        { attributes: { position: flatCube } },
        { attributes: { position: flatCube } },
        { attributes: { position: flatCube } },
      ],
    };

    const lines = groupResultIntoBomLines(result);

    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Гвинт M6x20', qty: 3 }),
        expect.objectContaining({ name: 'Кутник', qty: 1 }),
      ]),
    );
    expect(lines).toHaveLength(2);
  });

  it('labels dimensions as geometry-derived, not an authoritative drawing annotation', () => {
    const result = {
      root: { name: 'Root', meshes: [], children: [{ name: 'Деталь', meshes: [0], children: [] }] },
      meshes: [{ attributes: { position: flatCube } }],
    };
    const lines = groupResultIntoBomLines(result);
    expect(lines[0].dimensionsCm).toContain('за геометрією');
  });

  it('falls back to one line per mesh when there is no assembly tree at all', () => {
    const result = {
      root: undefined,
      meshes: [{ name: 'Single part', attributes: { position: flatCube } }],
    };
    const lines = groupResultIntoBomLines(result);
    expect(lines).toEqual([expect.objectContaining({ name: 'Single part', qty: 1 })]);
  });

  it('returns no lines for a result with neither a tree nor any meshes', () => {
    expect(groupResultIntoBomLines({ root: undefined, meshes: [] })).toEqual([]);
  });

  it('is null for dimensions when a leaf has no mesh position data', () => {
    const result = {
      root: { name: 'Root', meshes: [], children: [{ name: 'Деталь', meshes: [0], children: [] }] },
      meshes: [{ attributes: {} }],
    };
    const lines = groupResultIntoBomLines(result);
    expect(lines[0].dimensionsCm).toBeNull();
  });
});
