import { BadRequestException } from '@nestjs/common';
import { PackBox, TruckDims, packBoxesIntoTrucks } from './load-plan-packing';

function box(overrides: Partial<PackBox> = {}): PackBox {
  return {
    customerOrderItemId: 'item-1',
    assemblyId: 'assembly-1',
    lengthCm: 50,
    widthCm: 40,
    heightCm: 30,
    weightKg: 10,
    unitsQty: 1,
    ...overrides,
  };
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
