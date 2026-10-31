import { optimizeBarCutting, optimizeSheetNesting } from './cutting-optimizer';

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
