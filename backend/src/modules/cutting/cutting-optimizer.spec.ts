import { optimizeBarCutting, optimizeSheetNesting, optimizeIrregularSheetNesting } from './cutting-optimizer';

describe('optimizeBarCutting', () => {
  it('packs demand that fits into a single fresh bar', () => {
    const plan = optimizeBarCutting([{ label: 'a', lengthCm: 200, qty: 3 }], 600, 0, []);

    expect(plan.freshBarsUsed).toBe(1);
    expect(plan.remnantsUsed).toEqual([]);
    expect(plan.stockItems).toHaveLength(1);
    expect(plan.stockItems[0].cuts).toHaveLength(3);
    expect(plan.stockItems[0].leftoverLengthCm).toBe(0);
  });

  it('overflows into a second fresh bar when demand exceeds one bar', () => {
    const plan = optimizeBarCutting([{ label: 'a', lengthCm: 400, qty: 2 }], 600, 0, []);

    expect(plan.freshBarsUsed).toBe(2);
    expect(plan.stockItems).toHaveLength(2);
    for (const item of plan.stockItems) {
      expect(item.cuts).toHaveLength(1);
      expect(item.leftoverLengthCm).toBe(200);
    }
  });

  it('prefers an available remnant over opening a fresh bar', () => {
    const plan = optimizeBarCutting([{ label: 'a', lengthCm: 150, qty: 1 }], 600, 0, [{ remnantId: 'r1', lengthCm: 200 }]);

    expect(plan.freshBarsUsed).toBe(0);
    expect(plan.remnantsUsed).toEqual(['r1']);
    expect(plan.stockItems[0].sourceKind).toBe('REMNANT');
    expect(plan.stockItems[0].leftoverLengthCm).toBe(50);
  });

  it('best-fits the smallest sufficient remnant rather than a larger one', () => {
    const plan = optimizeBarCutting(
      [{ label: 'a', lengthCm: 150, qty: 1 }],
      600,
      0,
      [
        { remnantId: 'big', lengthCm: 500 },
        { remnantId: 'small', lengthCm: 160 },
      ],
    );

    expect(plan.remnantsUsed).toEqual(['small']);
  });

  it('charges kerf against the stock item leftover', () => {
    const plan = optimizeBarCutting([{ label: 'a', lengthCm: 100, qty: 1 }], 200, 10, []);

    // kerfMm=10 -> kerfCm=1; 200 - (100 + 1) = 99
    expect(plan.stockItems[0].leftoverLengthCm).toBe(99);
  });

  it('throws when a single piece cannot fit even a fresh bar', () => {
    expect(() => optimizeBarCutting([{ label: 'a', lengthCm: 700, qty: 1 }], 600, 0, [])).toThrow();
  });

  it('every demanded piece is accounted for across all stock items', () => {
    const plan = optimizeBarCutting(
      [
        { label: 'a', lengthCm: 250, qty: 2 },
        { label: 'b', lengthCm: 90, qty: 3 },
      ],
      600,
      0,
      [],
    );

    const allCuts = plan.stockItems.flatMap((s) => s.cuts);
    expect(allCuts).toHaveLength(5);
    expect(allCuts.filter((c) => c.label === 'a')).toHaveLength(2);
    expect(allCuts.filter((c) => c.label === 'b')).toHaveLength(3);
  });
});

describe('optimizeSheetNesting', () => {
  it('places two pieces side by side within one fresh sheet without overlap', () => {
    const plan = optimizeSheetNesting([{ label: 'a', widthCm: 100, heightCm: 50, qty: 2 }], 300, 200, 0, [], false);

    expect(plan.freshSheetsUsed).toBe(1);
    const cuts = plan.stockItems[0].cuts;
    expect(cuts).toHaveLength(2);
    expect(cuts[0].posXCm).toBe(0);
    expect(cuts[1].posXCm).toBe(100); // second piece starts exactly where the first ends
    expect(cuts[0].posYCm).toBe(cuts[1].posYCm);
  });

  it('reports a clean leftover strip when the sheet is not fully used', () => {
    const plan = optimizeSheetNesting([{ label: 'a', widthCm: 100, heightCm: 50, qty: 1 }], 300, 200, 0, [], false);

    const item = plan.stockItems[0];
    expect(item.leftoverLengthCm).toBe(300);
    expect(item.leftoverWidthCm).toBe(150);
  });

  it('rotates a piece to fit when the normal orientation does not', () => {
    const plan = optimizeSheetNesting([{ label: 'a', widthCm: 250, heightCm: 50, qty: 1 }], 200, 300, 0, [], true);

    expect(plan.freshSheetsUsed).toBe(1);
    expect(plan.stockItems[0].cuts[0].rotated).toBe(true);
  });

  it('throws when rotation is disabled and the piece cannot fit either way', () => {
    expect(() => optimizeSheetNesting([{ label: 'a', widthCm: 250, heightCm: 50, qty: 1 }], 200, 300, 0, [], false)).toThrow();
  });

  it('prefers an available remnant sheet over opening a fresh sheet', () => {
    const plan = optimizeSheetNesting([{ label: 'a', widthCm: 100, heightCm: 100, qty: 1 }], 300, 300, 0, [{ remnantId: 'r1', lengthCm: 150, widthCm: 150 }], false);

    expect(plan.freshSheetsUsed).toBe(0);
    expect(plan.remnantsUsed).toEqual(['r1']);
  });

  it('keeps every placed piece within sheet bounds and non-overlapping', () => {
    const demand = [{ label: 'a', widthCm: 30, heightCm: 40, qty: 10 }];
    const plan = optimizeSheetNesting(demand, 200, 200, 0, [], false);

    for (const item of plan.stockItems) {
      for (const cut of item.cuts) {
        expect(cut.posXCm + cut.pieceLengthCm).toBeLessThanOrEqual(item.lengthCm);
        expect(cut.posYCm + cut.pieceWidthCm).toBeLessThanOrEqual(item.widthCm);
      }
      for (let i = 0; i < item.cuts.length; i++) {
        for (let j = i + 1; j < item.cuts.length; j++) {
          const a = item.cuts[i];
          const b = item.cuts[j];
          const overlap = a.posXCm < b.posXCm + b.pieceLengthCm && a.posXCm + a.pieceLengthCm > b.posXCm && a.posYCm < b.posYCm + b.pieceWidthCm && a.posYCm + a.pieceWidthCm > b.posYCm;
          expect(overlap).toBe(false);
        }
      }
    }
    const totalPlaced = plan.stockItems.flatMap((s) => s.cuts);
    expect(totalPlaced).toHaveLength(10);
  });
});

describe('optimizeIrregularSheetNesting', () => {
  // Reimplemented independently of the algorithm under test (not reusing its
  // internal helpers) — a shared bug in both would otherwise go undetected.
  function pointInPoly(x: number, y: number, poly: [number, number][]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function insideShape(x: number, y: number, shape: { outerCm: [number, number][]; holesCm: [number, number][][] }): boolean {
    if (!pointInPoly(x, y, shape.outerCm)) return false;
    return !shape.holesCm.some((h) => pointInPoly(x, y, h));
  }
  function boundsOf(poly: [number, number][]) {
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  }
  function shapesOverlap(a: { outerCm: [number, number][]; holesCm: [number, number][][] }, b: { outerCm: [number, number][]; holesCm: [number, number][][] }, step = 0.5): boolean {
    const bb = boundsOf(a.outerCm);
    for (let x = bb.minX + step / 2; x < bb.maxX; x += step) {
      for (let y = bb.minY + step / 2; y < bb.maxY; y += step) {
        if (insideShape(x, y, a) && insideShape(x, y, b)) return true;
      }
    }
    return false;
  }
  function shoelaceArea(poly: [number, number][]): number {
    let sum = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      sum += x1 * y2 - x2 * y1;
    }
    return Math.abs(sum / 2);
  }

  const square10: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  // L-shape, same concave fixture shape as the STEP boundary-trace tests — 10x5 bottom bar + 5x5 left bar, area 75cm².
  const lShape: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 5],
    [5, 5],
    [5, 10],
    [0, 10],
  ];

  it('places a single square piece at the sheet origin', () => {
    const plan = optimizeIrregularSheetNesting([{ label: 'a', outerCm: square10, holesCm: [], qty: 1 }], 30, 20, 0, [], false);

    expect(plan.freshSheetsUsed).toBe(1);
    expect(plan.stockItems[0].cuts).toHaveLength(1);
    expect(plan.stockItems[0].cuts[0].posXCm).toBe(0);
    expect(plan.stockItems[0].cuts[0].posYCm).toBe(0);
    expect(plan.stockItems[0].cuts[0].rotated).toBe(false);
  });

  it('places two squares on one sheet without overlap when both fit', () => {
    const plan = optimizeIrregularSheetNesting([{ label: 'a', outerCm: square10, holesCm: [], qty: 2 }], 30, 20, 0, [], false);

    expect(plan.freshSheetsUsed).toBe(1);
    const [c1, c2] = plan.stockItems[0].cuts;
    expect(c2).toBeDefined();
    expect(shapesOverlap(c1, c2)).toBe(false);
  });

  it('overflows to a second fresh sheet when two pieces genuinely cannot coexist on one', () => {
    const plan = optimizeIrregularSheetNesting([{ label: 'a', outerCm: square10, holesCm: [], qty: 2 }], 15, 15, 0, [], false);

    expect(plan.freshSheetsUsed).toBe(2);
    expect(plan.stockItems[0].cuts).toHaveLength(1);
    expect(plan.stockItems[1].cuts).toHaveLength(1);
  });

  it('nests a concave L-shaped piece without self-overlap against a square, and keeps both within sheet bounds', () => {
    const plan = optimizeIrregularSheetNesting(
      [
        { label: 'l', outerCm: lShape, holesCm: [], qty: 1 },
        { label: 'sq', outerCm: square10, holesCm: [], qty: 1 },
      ],
      30,
      20,
      0,
      [],
      false,
    );

    const allCuts = plan.stockItems.flatMap((s) => s.cuts);
    expect(allCuts).toHaveLength(2);
    for (const item of plan.stockItems) {
      for (const cut of item.cuts) {
        const b = boundsOf(cut.outerCm);
        expect(b.minX).toBeGreaterThanOrEqual(0);
        expect(b.minY).toBeGreaterThanOrEqual(0);
        expect(b.maxX).toBeLessThanOrEqual(item.lengthCm);
        expect(b.maxY).toBeLessThanOrEqual(item.widthCm);
      }
      for (let i = 0; i < item.cuts.length; i++) {
        for (let j = i + 1; j < item.cuts.length; j++) {
          expect(shapesOverlap(item.cuts[i], item.cuts[j])).toBe(false);
        }
      }
    }
  });

  it('carries holes through to the placed output, at roughly the correct area', () => {
    const hole: [number, number][] = [
      [3, 3],
      [7, 3],
      [7, 7],
      [3, 7],
    ];
    const plan = optimizeIrregularSheetNesting([{ label: 'a', outerCm: square10, holesCm: [hole], qty: 1 }], 30, 20, 0, [], false);

    const cut = plan.stockItems[0].cuts[0];
    expect(cut.holesCm).toHaveLength(1);
    expect(shoelaceArea(cut.holesCm[0])).toBeCloseTo(16, 0);
  });

  it('rotates a piece 90° to fit when the un-rotated bounding box does not', () => {
    const wideStrip: [number, number][] = [
      [0, 0],
      [20, 0],
      [20, 5],
      [0, 5],
    ];
    const plan = optimizeIrregularSheetNesting([{ label: 'a', outerCm: wideStrip, holesCm: [], qty: 1 }], 10, 25, 0, [], true);

    expect(plan.freshSheetsUsed).toBe(1);
    expect(plan.stockItems[0].cuts[0].rotated).toBe(true);
  });

  it('throws when rotation is disabled and the piece cannot fit either way', () => {
    const wideStrip: [number, number][] = [
      [0, 0],
      [20, 0],
      [20, 5],
      [0, 5],
    ];
    expect(() => optimizeIrregularSheetNesting([{ label: 'a', outerCm: wideStrip, holesCm: [], qty: 1 }], 10, 25, 0, [], false)).toThrow();
  });

  it('prefers an available remnant over opening a fresh sheet', () => {
    const smallSquare: [number, number][] = [
      [0, 0],
      [5, 0],
      [5, 5],
      [0, 5],
    ];
    const plan = optimizeIrregularSheetNesting(
      [{ label: 'a', outerCm: smallSquare, holesCm: [], qty: 1 }],
      50,
      50,
      0,
      [{ remnantId: 'r1', lengthCm: 8, widthCm: 8 }],
      false,
    );

    expect(plan.freshSheetsUsed).toBe(0);
    expect(plan.remnantsUsed).toEqual(['r1']);
  });
});
