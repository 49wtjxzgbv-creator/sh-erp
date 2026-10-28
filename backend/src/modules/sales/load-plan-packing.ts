import { CodedBadRequestException } from '../../common/api-exceptions';

/**
 * 3D bin-packing for the load-plan module (2026-10-28) — a deliberately
 * practical heuristic, not a globally optimal solver for the NP-hard
 * bin-packing problem (same honest tradeoff any real warehouse tool
 * makes). Pure function, no Prisma/DI, so it's trivially unit-testable —
 * same philosophy as AssembliesService's own recursive cost/weight calc.
 *
 * Boxes are placed upright, in the orientation their own L×W×H already
 * describe (no automatic rotation during layout — whoever fills in an
 * Assembly's box dimensions is assumed to have picked a sensible loading
 * face). Two-stage approach per truck:
 *   1. Layer/level packing along the truck's height (Z): boxes sorted
 *      tallest-first, each level is a 2D Next-Fit-Decreasing-Height shelf
 *      pack of the truck's floor (L×W) using only boxes short enough to
 *      share that level without wasting more vertical space than needed.
 *   2. Weight budget (`maxWeightKg`) is enforced on top, in placement
 *      order — a box that would push the running total over budget
 *      overflows to the next truck even if it geometrically fit.
 * Anything that doesn't fit in the current truck (height-limited or
 * weight-limited) recurses into a fresh truck, so the result may span
 * more trucks than `Math.ceil(totalVolume / truckVolume)` would suggest
 * — expected for irregular cargo, not a bug.
 */

export interface PackBox {
  customerOrderItemId: string;
  assemblyId: string;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
  /** How many finished units of the order line this one box represents — carried through untouched, never read by the packing logic itself. */
  unitsQty: number;
}

export interface TruckDims {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  maxWeightKg: number;
}

export interface PlacedBox extends PackBox {
  truckIndex: number;
  x: number;
  y: number;
  z: number;
}

const MAX_TRUCKS = 200;

export function packBoxesIntoTrucks(boxes: PackBox[], truck: TruckDims): PlacedBox[] {
  for (const box of boxes) {
    if (box.lengthCm > truck.lengthCm || box.widthCm > truck.widthCm || box.heightCm > truck.heightCm) {
      throw new CodedBadRequestException(
        'LOAD_PLAN_BOX_TOO_LARGE',
        `Assembly ${box.assemblyId}'s box (${box.lengthCm}×${box.widthCm}×${box.heightCm} cm) does not fit inside the truck even empty ` +
          `(${truck.lengthCm}×${truck.widthCm}×${truck.heightCm} cm) — pick a bigger transport type or fix this assembly's box dimensions.`,
      );
    }
    if (box.weightKg > truck.maxWeightKg) {
      throw new CodedBadRequestException(
        'LOAD_PLAN_BOX_TOO_HEAVY',
        `Assembly ${box.assemblyId}'s box weighs ${box.weightKg} kg, more than the truck's own max weight (${truck.maxWeightKg} kg).`,
      );
    }
  }
  return packRemaining(boxes, truck, 1);
}

function packRemaining(boxes: PackBox[], truck: TruckDims, truckIndex: number): PlacedBox[] {
  if (boxes.length === 0) return [];
  if (truckIndex > MAX_TRUCKS) {
    throw new CodedBadRequestException(
      'LOAD_PLAN_TOO_MANY_TRUCKS',
      `Packing needed more than ${MAX_TRUCKS} trucks — check the selected transport type's dimensions and this order's assembly packaging.`,
    );
  }

  const { placed, overflow } = layoutSingleTruck(boxes, truck);
  const kept = placed.map((p) => ({ ...p, truckIndex }));
  return [...kept, ...packRemaining(overflow, truck, truckIndex + 1)];
}

/**
 * Lays `boxes` out in ONE truck only — no recursion into further trucks.
 * Anything that doesn't fit (height- or weight-limited) comes back in
 * `overflow` instead of being silently dropped or reassigned elsewhere.
 * Used directly by LoadPlanService#get to recompute a single, already-
 * assigned-by-the-user truck's geometry after a manual move — overflow
 * here means "this truck is over capacity", surfaced as a UI warning,
 * not auto-resolved by shuffling the user's own assignment.
 */
export function layoutSingleTruck(boxes: PackBox[], truck: TruckDims): { placed: PlacedBox[]; overflow: PackBox[] } {
  let remaining = [...boxes].sort((a, b) => b.heightCm - a.heightCm);
  const placedThisTruck: { box: PackBox; x: number; y: number; z: number }[] = [];
  let z = 0;

  while (remaining.length > 0 && z < truck.heightCm) {
    const level = packOneLevel(remaining, truck.lengthCm, truck.widthCm);
    if (level.placed.length === 0) break; // shouldn't happen when every box individually fits the envelope — guards against an infinite loop
    if (z + level.levelHeightCm > truck.heightCm) {
      // This level doesn't fit height-wise at all — everything in it overflows.
      remaining = [...level.placed.map((p) => p.box), ...level.unplaced];
      break;
    }
    for (const p of level.placed) placedThisTruck.push({ box: p.box, x: p.x, y: p.y, z });
    z += level.levelHeightCm;
    remaining = level.unplaced;
  }

  const placed: PlacedBox[] = [];
  const overflow: PackBox[] = [...remaining];
  let truckWeight = 0;
  for (const p of placedThisTruck) {
    if (truckWeight + p.box.weightKg > truck.maxWeightKg) {
      overflow.push(p.box);
    } else {
      truckWeight += p.box.weightKg;
      placed.push({ ...p.box, truckIndex: 1, x: p.x, y: p.y, z: p.z });
    }
  }

  return { placed, overflow };
}

/**
 * One height-level's floor layout: Next-Fit-Decreasing-Height shelf
 * packing of `boxes` (already height-sorted descending by the caller)
 * onto a `floorLengthCm × floorWidthCm` rectangle. Rows run along the
 * length axis; a row's depth (along width) is set by the first box
 * placed in it, so later boxes queued after a much shorter one may still
 * get pushed to `unplaced` for the next level even though a perfect
 * repacking could fit them here — the accepted NFDH tradeoff for a
 * roughly 2x-worst-case-bounded algorithm that's simple to reason about.
 */
function packOneLevel(
  boxes: PackBox[],
  floorLengthCm: number,
  floorWidthCm: number,
): { placed: { box: PackBox; x: number; y: number }[]; unplaced: PackBox[]; levelHeightCm: number } {
  const placed: { box: PackBox; x: number; y: number }[] = [];
  const unplaced: PackBox[] = [];
  let x = 0;
  let y = 0;
  let rowDepth = 0;
  let levelHeightCm = 0;

  for (const box of boxes) {
    if (x + box.lengthCm > floorLengthCm) {
      // next row
      x = 0;
      y += rowDepth;
      rowDepth = 0;
    }
    if (y + box.widthCm > floorWidthCm) {
      unplaced.push(box);
      continue;
    }
    placed.push({ box, x, y });
    x += box.lengthCm;
    rowDepth = Math.max(rowDepth, box.widthCm);
    levelHeightCm = Math.max(levelHeightCm, box.heightCm);
  }

  return { placed, unplaced, levelHeightCm };
}
