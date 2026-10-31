// Plain CommonJS require — this child script isn't a TS module (spawned
// directly by node, copied as a raw asset by nest-cli.json), but its pure
// grouping/bounding-box logic is exported for exactly this: a real unit
// test without spawning a process or touching OCCT/WASM.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { computeBoundingBoxCm, collectLeaves, groupResultIntoBomLines, extractFlatFaceOutline } = require('./step-extract-bom-child.js');

/**
 * The boundary trace's projection basis (which 3D axis becomes local 2D
 * u/v) is an implementation detail — depends on an arbitrary perpendicular
 * vector choice, not something a test should hardcode exact coordinates
 * against. Area and point count are robust, meaningful invariants instead:
 * a wrong boundary trace or mis-triangulated fixture would almost
 * certainly produce a wrong area.
 */
function polygonAreaAbs(points: [number, number][]) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum / 2);
}

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

  it('also returns the bounding box as structured numbers (lengthCm/widthCm/heightCm) for розкрій auto-fill', () => {
    const result = {
      root: { name: 'Root', meshes: [], children: [{ name: 'Деталь', meshes: [0], children: [] }] },
      meshes: [{ attributes: { position: flatCube } }],
    };
    const lines = groupResultIntoBomLines(result);
    expect(lines[0]).toEqual(expect.objectContaining({ lengthCm: 1, widthCm: 1, heightCm: 1 }));
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

  it('falls back to shapeKind "bbox" (no outerCm/holesCm) when the mesh has no index/brep_faces — the simple existing fixtures above', () => {
    const result = {
      root: { name: 'Root', meshes: [], children: [{ name: 'Деталь', meshes: [0], children: [] }] },
      meshes: [{ attributes: { position: flatCube } }],
    };
    const lines = groupResultIntoBomLines(result);
    expect(lines[0]).toEqual(expect.objectContaining({ shapeKind: 'bbox', outerCm: null, holesCm: null }));
  });
});

describe('extractFlatFaceOutline', () => {
  // A flat 100mm x 100mm square in the XY plane (z=0), two triangles,
  // one brep_face spanning both.
  const squarePosition = {
    array: [
      0, 0, 0, // v0
      100, 0, 0, // v1
      100, 100, 0, // v2
      0, 100, 0, // v3
    ],
  };
  const squareIndex = { array: [0, 1, 2, 0, 2, 3] };
  const squareBrepFaces = [{ first: 0, last: 1 }];

  it('traces a flat square face into a single 4-point outer loop of the correct area, no holes', () => {
    const mesh = { attributes: { position: squarePosition }, index: squareIndex, brep_faces: squareBrepFaces };
    const result = extractFlatFaceOutline(mesh);

    expect(result.holesCm).toEqual([]);
    expect(result.outerCm).toHaveLength(4);
    expect(polygonAreaAbs(result.outerCm)).toBeCloseTo(100, 1); // 10cm x 10cm = 100cm²
  });

  it('returns null when there are no brep_faces/index (not a flat-face-capable mesh)', () => {
    expect(extractFlatFaceOutline({ attributes: { position: squarePosition } })).toBeNull();
  });

  // A 100mm x 100mm square "picture frame" around a 40mm x 40mm hole
  // (30,30)-(70,70) — 8 triangles bridging the outer and inner squares,
  // one brep_face spanning all of them. Hand-verified by hand-tracing
  // every triangle edge's occurrence count before writing this fixture —
  // see the task notes for the full derivation.
  it('traces a square-with-a-hole face into an outer loop and one hole loop', () => {
    const position = {
      array: [
        0, 0, 0, // v0 outer
        100, 0, 0, // v1 outer
        100, 100, 0, // v2 outer
        0, 100, 0, // v3 outer
        30, 30, 0, // v4 inner
        70, 30, 0, // v5 inner
        70, 70, 0, // v6 inner
        30, 70, 0, // v7 inner
      ],
    };
    const index = {
      array: [
        0, 1, 5, 0, 5, 4, // bottom bridge
        1, 2, 6, 1, 6, 5, // right bridge
        2, 3, 7, 2, 7, 6, // top bridge
        3, 0, 4, 3, 4, 7, // left bridge
      ],
    };
    const mesh = { attributes: { position }, index, brep_faces: [{ first: 0, last: 7 }] };

    const result = extractFlatFaceOutline(mesh);

    expect(result.outerCm).toHaveLength(4);
    expect(polygonAreaAbs(result.outerCm)).toBeCloseTo(100, 1); // 10cm x 10cm = 100cm²
    expect(result.holesCm).toHaveLength(1);
    expect(result.holesCm[0]).toHaveLength(4);
    expect(polygonAreaAbs(result.holesCm[0])).toBeCloseTo(16, 1); // 4cm x 4cm hole = 16cm²
  });

  // An L-shaped (concave) outline, fan-triangulated from v0 — 4 triangles,
  // one brep_face. Proves boundary tracing handles a concave vertex
  // correctly (topology-based, no convexity assumption).
  it('traces a concave L-shaped face correctly, including its reflex corner', () => {
    const position = {
      array: [
        0, 0, 0, // v0
        100, 0, 0, // v1
        100, 50, 0, // v2
        50, 50, 0, // v3 — reflex (concave) corner of the L
        50, 100, 0, // v4
        0, 100, 0, // v5
      ],
    };
    const index = { array: [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5] };
    const mesh = { attributes: { position }, index, brep_faces: [{ first: 0, last: 3 }] };

    const result = extractFlatFaceOutline(mesh);

    expect(result.holesCm).toEqual([]);
    expect(result.outerCm).toHaveLength(6);
    // 10cm x 5cm bottom bar + 5cm x 5cm left bar = 75cm² — a convex-hull-only
    // (bounding-box) approach would wrongly report 100cm² (10x10), so this
    // also proves the concave notch is actually honored, not just ignored.
    expect(polygonAreaAbs(result.outerCm)).toBeCloseTo(75, 1);
  });
});
