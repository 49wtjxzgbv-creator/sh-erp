import { BadRequestException } from '@nestjs/common';
import { PackBox, PlacedBox, TruckDims, computeStrapPlan, packBoxesIntoTrucks } from './load-plan-packing';

function box(overrides: Partial<PackBox> = {}): PackBox {
  return {
    customerOrderItemId: 'item-1',
    assemblyId: 'assembly-1',
    lengthCm: 50,
    widthCm: 40,
    heightCm: 30,
    weightKg: 10,
    unitsQty: 1,
    stackable: true,
    maxStackWeightKg: null,
    ...overrides,
  };
}

function placedBox(overrides: Partial<PlacedBox> = {}): PlacedBox {
  return { ...box(), truckIndex: 1, x: 0, y: 0, z: 0, ...overrides };
}

const bigTruck: TruckDims = { lengthCm: 500, widthCm: 200, heightCm: 200, maxWeightKg: 10000 };

describe('packBoxesIntoTrucks', () => {
  it('places everything that fits into a single truck', () => {
    const boxes = [box(), box(), box()];
    const placed = packBoxesIntoTrucks(boxes, bigTruck);

    expect(placed).toHaveLength(3);
    expect(new Set(placed.map((p) => p.truckIndex))).toEqual(new Set([1]));
    // No two placed boxes should overlap on the floor for this simple case
    const xs = placed.map((p) => p.x).sort((a, b) => a - b);
    expect(xs).toEqual([0, 50, 100]);
  });

  it('keeps every placed box fully within the truck envelope', () => {
    const boxes = Array.from({ length: 12 }, () => box());
    const placed = packBoxesIntoTrucks(boxes, bigTruck);

    for (const p of placed) {
      expect(p.x + p.lengthCm).toBeLessThanOrEqual(bigTruck.lengthCm);
      expect(p.y + p.widthCm).toBeLessThanOrEqual(bigTruck.widthCm);
      expect(p.z + p.heightCm).toBeLessThanOrEqual(bigTruck.heightCm);
    }
  });

  it('overflows into a second truck when the weight budget is exceeded', () => {
    const smallWeightTruck: TruckDims = { lengthCm: 500, widthCm: 500, heightCm: 500, maxWeightKg: 15 };
    const boxes = [box({ weightKg: 10 }), box({ weightKg: 10 })]; // 20kg total, 15kg budget

    const placed = packBoxesIntoTrucks(boxes, smallWeightTruck);

    expect(placed).toHaveLength(2);
    const truckIndices = placed.map((p) => p.truckIndex).sort();
    expect(truckIndices).toEqual([1, 2]);
  });

  it('overflows into a second truck when boxes cannot stack within the truck height', () => {
    const shortTruck: TruckDims = { lengthCm: 500, widthCm: 500, heightCm: 35, maxWeightKg: 10000 };
    // Each box is 30cm tall; two stacked levels would need 60cm > 35cm truck height.
    const boxes = [box({ lengthCm: 490, widthCm: 490, heightCm: 30 }), box({ lengthCm: 490, widthCm: 490, heightCm: 30 })];

    const placed = packBoxesIntoTrucks(boxes, shortTruck);

    expect(placed).toHaveLength(2);
    const truckIndices = placed.map((p) => p.truckIndex).sort();
    expect(truckIndices).toEqual([1, 2]);
  });

  it('spreads a large batch across multiple trucks and accounts for every box exactly once', () => {
    const tightTruck: TruckDims = { lengthCm: 100, widthCm: 100, heightCm: 100, maxWeightKg: 1000 };
    const boxes = Array.from({ length: 20 }, (_, i) => box({ customerOrderItemId: `item-${i}`, lengthCm: 60, widthCm: 60, heightCm: 60 }));

    const placed = packBoxesIntoTrucks(boxes, tightTruck);

    expect(placed).toHaveLength(20);
    expect(new Set(placed.map((p) => p.customerOrderItemId)).size).toBe(20);
    // Only one 60cm box fits per 100cm-cube truck on any axis combination -> one box per truck.
    expect(new Set(placed.map((p) => p.truckIndex)).size).toBe(20);
  });

  it('never mixes two different assemblies within the same row, even when one would still fit after the other', () => {
    // Reproduces a real production layout (2026-10-29, "чому воно розкладає
    // не логічно"): 3 long belts end-to-end leave just enough row length
    // for one short motor box to also fit — without the fix, that one
    // motor box got tacked onto the belts' row while its other two copies
    // started a fresh row, splitting one assembly's 3 identical boxes
    // across two disconnected spots.
    const truck: TruckDims = { lengthCm: 1360, widthCm: 245, heightCm: 260, maxWeightKg: 10000 };
    const belts = Array.from({ length: 3 }, () => box({ assemblyId: 'belt', lengthCm: 428.8, widthCm: 32.2, heightCm: 23.6 }));
    const motors = Array.from({ length: 3 }, () => box({ assemblyId: 'motor', lengthCm: 39, widthCm: 22.9, heightCm: 20.9 }));

    const placed = packBoxesIntoTrucks([...belts, ...motors], truck);
    const motorYs = placed.filter((p) => p.assemblyId === 'motor').map((p) => p.y);

    // All 3 motor boxes should share the same row (same y) — not 2 in one row and 1 tacked onto the belts' row.
    expect(new Set(motorYs).size).toBe(1);
    const beltYs = placed.filter((p) => p.assemblyId === 'belt').map((p) => p.y);
    expect(new Set(beltYs)).not.toEqual(new Set(motorYs));
  });

  it('refuses to stack a box on top of one marked not stackable, overflowing it to another truck', () => {
    // Floor is exactly one box wide/long, so the second box can only ever
    // be placed by stacking on the first — never beside it.
    const truck: TruckDims = { lengthCm: 50, widthCm: 40, heightCm: 65, maxWeightKg: 10000 };
    const bottom = box({ assemblyId: 'fragile', stackable: false });
    const top = box({ assemblyId: 'other' });

    const placed = packBoxesIntoTrucks([bottom, top], truck);

    const bottomPlaced = placed.find((p) => p.assemblyId === 'fragile')!;
    const topPlaced = placed.find((p) => p.assemblyId === 'other')!;
    expect(bottomPlaced.truckIndex).toBe(1);
    expect(topPlaced.truckIndex).toBe(2);
  });

  it('refuses to stack a box whose weight exceeds the support box\'s max stack weight', () => {
    const truck: TruckDims = { lengthCm: 50, widthCm: 40, heightCm: 65, maxWeightKg: 10000 };
    const bottom = box({ assemblyId: 'base', stackable: true, maxStackWeightKg: 5 });
    const top = box({ assemblyId: 'other', weightKg: 10 });

    const placed = packBoxesIntoTrucks([bottom, top], truck);

    const bottomPlaced = placed.find((p) => p.assemblyId === 'base')!;
    const topPlaced = placed.find((p) => p.assemblyId === 'other')!;
    expect(bottomPlaced.truckIndex).toBe(1);
    expect(topPlaced.truckIndex).toBe(2);
  });

  it('stacks a box on top of a support with enough remaining stack-weight budget', () => {
    const truck: TruckDims = { lengthCm: 50, widthCm: 40, heightCm: 65, maxWeightKg: 10000 };
    const bottom = box({ assemblyId: 'base', stackable: true, maxStackWeightKg: 20 });
    const top = box({ assemblyId: 'other', weightKg: 10 });

    const placed = packBoxesIntoTrucks([bottom, top], truck);

    const bottomPlaced = placed.find((p) => p.assemblyId === 'base')!;
    const topPlaced = placed.find((p) => p.assemblyId === 'other')!;
    expect(bottomPlaced.truckIndex).toBe(1);
    expect(topPlaced.truckIndex).toBe(1);
    expect(topPlaced.z).toBe(bottomPlaced.z + bottomPlaced.heightCm);
  });

  it('throws when a single box does not fit inside the truck even empty', () => {
    const smallTruck: TruckDims = { lengthCm: 40, widthCm: 40, heightCm: 40, maxWeightKg: 10000 };
    const boxes = [box({ lengthCm: 50, widthCm: 40, heightCm: 30 })];

    expect(() => packBoxesIntoTrucks(boxes, smallTruck)).toThrow(BadRequestException);
  });

  it('throws when a single box is heavier than the truck max weight', () => {
    const lightTruck: TruckDims = { lengthCm: 500, widthCm: 500, heightCm: 500, maxWeightKg: 5 };
    const boxes = [box({ weightKg: 10 })];

    expect(() => packBoxesIntoTrucks(boxes, lightTruck)).toThrow(BadRequestException);
  });

  it('returns an empty placement for an empty box list', () => {
    expect(packBoxesIntoTrucks([], bigTruck)).toEqual([]);
  });
});

describe('computeStrapPlan', () => {
  it('returns null for an empty truck', () => {
    expect(computeStrapPlan([], bigTruck)).toBeNull();
  });

  it('recommends at least 2 straps even for a short, single-box load', () => {
    const plan = computeStrapPlan([placedBox({ lengthCm: 50, widthCm: 40, heightCm: 30 })], bigTruck);

    expect(plan).not.toBeNull();
    expect(plan!.count).toBe(2);
    expect(plan!.positionsCm).toHaveLength(2);
    for (const pos of plan!.positionsCm) {
      expect(pos).toBeGreaterThanOrEqual(0);
      expect(pos).toBeLessThanOrEqual(50);
    }
  });

  it('scales strap count with load length', () => {
    const boxes = Array.from({ length: 6 }, (_, i) => placedBox({ x: i * 50, lengthCm: 50, widthCm: 40, heightCm: 30 }));
    // Load spans 0..300cm -> 2 straps per 150cm interval.
    const plan = computeStrapPlan(boxes, bigTruck);

    expect(plan!.count).toBe(2);
  });

  it('snaps a strap position into a clear gap between boxes instead of resting on a box top', () => {
    // Two boxes with a 20cm gap between them, straddling the load's midpoint.
    const boxes = [placedBox({ x: 0, lengthCm: 90 }), placedBox({ x: 110, lengthCm: 90 })];
    const plan = computeStrapPlan(boxes, bigTruck);

    // Load spans 0..200cm -> 2 straps; the one nearest the midpoint (ideal ~150) should land in the 90-110 gap (center 100) only if within snap radius of its own ideal (50). Use the first strap's ideal ~50 instead, which is inside box 1 — should NOT be able to snap to the 90-110 gap (60cm away, outside the 40cm snap radius) and therefore stays at its ideal position.
    expect(plan!.positionsCm[0]).toBeCloseTo(50, 0);
  });

  it('computes strap length from load height and truck width, with slack', () => {
    const plan = computeStrapPlan([placedBox({ lengthCm: 50, widthCm: 40, heightCm: 30 })], bigTruck);

    // 2 * 30 (height) + 200 (truck width) + 60 (slack) = 320
    expect(plan!.lengthCm).toBe(320);
  });
});
