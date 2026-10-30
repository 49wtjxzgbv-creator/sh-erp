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
 *      tallest-first (heaviest-first as a tiebreak among equal heights —
 *      see weight-aware stacking below), each level is a 2D
 *      Next-Fit-Decreasing-Height shelf pack of the truck's floor (L×W).
 *      A single row never mixes two different assemblies (see
 *      `packOneLevel`'s own comment) — same-SKU boxes always end up
 *      grouped, even if that leaves a little unused length at a row's end.
 *   2. Weight budget (`maxWeightKg`) is enforced on top, in placement
 *      order — a box that would push the running total over budget
 *      overflows to the next truck even if it geometrically fit.
 * Anything that doesn't fit in the current truck (height-limited,
 * weight-limited, or stacking-limited — see below) recurses into a fresh
 * truck, so the result may span more trucks than
 * `Math.ceil(totalVolume / truckVolume)` would suggest — expected for
 * irregular cargo, not a bug.
 *
 * Weight-aware stacking (2026-10-30, "логіка завантаження якась
 * неправильна... треба зважати на вагу розмір форму, як це правильно
 * розміщати") — real freight loading doesn't just fit boxes into empty
 * floor space, it also cares what's allowed to rest on top of what. A box
 * is only placed at a given (x,y) in a level above the ground floor when
 * EVERY box in the level directly below it that its footprint overlaps is
 * both `stackable` and has enough `maxStackWeightKg` budget left for this
 * box's own weight — see `SupportEntry`/`packOneLevel`. A box that can't
 * find a legal resting spot anywhere in the current truck overflows to the
 * next one, same as a height- or weight-limited box already did. This is
 * a conservative approximation (a box resting on two supports below is
 * charged against BOTH at its full weight, not split proportionally by
 * overlap area) — deliberately erring toward "this box might not actually
 * fit here" over silently modeling a real support structure too
 * generously, in keeping with this module's own "practical, not a physics
 * engine" tradeoff elsewhere (see `computeStrapPlan`).
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
  /** Whether anything may be placed on top of this box at all. `false` means it must end up topmost in its stack regardless of remaining space elsewhere. */
  stackable: boolean;
  /** Combined weight (kg) this box can bear on top of it, when `stackable`. `null` means unlimited. Ignored when `stackable` is `false`. */
  maxStackWeightKg: number | null;
  /** Manual drag positioning (2026-10-30) — which LoadPlanItem row and which Nth box of it this is. Carried through untouched, never read by the packing logic itself; lets LoadPlanService#get match a returned PlacedBox back to a possible LoadPlanBoxPosition override. */
  loadPlanItemId: string;
  boxIndex: number;
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

/** One already-placed box, as seen from the level directly above it — only what's needed to check whether a new box may rest on it. */
interface SupportEntry {
  x: number;
  y: number;
  lengthCm: number;
  widthCm: number;
  stackable: boolean;
  /** Mutated in place as boxes in the level above get accepted onto this support — starts at `maxStackWeightKg ?? Infinity` (or 0 when not stackable). */
  remainingCapacityKg: number;
}

function footprintsOverlap(a: { x: number; y: number; lengthCm: number; widthCm: number }, b: { x: number; y: number; lengthCm: number; widthCm: number }): boolean {
  return a.x < b.x + b.lengthCm && a.x + a.lengthCm > b.x && a.y < b.y + b.widthCm && a.y + a.widthCm > b.y;
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
 * Anything that doesn't fit (height-, weight-, or stacking-limited) comes
 * back in `overflow` instead of being silently dropped or reassigned
 * elsewhere. Used directly by LoadPlanService#get to recompute a single,
 * already-assigned-by-the-user truck's geometry after a manual move —
 * overflow here means "this truck is over capacity", surfaced as a UI
 * warning, not auto-resolved by shuffling the user's own assignment.
 */
export function layoutSingleTruck(boxes: PackBox[], truck: TruckDims): { placed: PlacedBox[]; overflow: PackBox[] } {
  // Height-first (preserves the shelf-height efficiency this algorithm has
  // always relied on), weight as a tiebreak among equal-height boxes — of
  // two boxes that would otherwise compete for the same level, the heavier
  // one is offered first and so more likely claims a lower level. This is
  // a soft preference only; the REAL guarantee that nothing illegal ends
  // up resting on a fragile/over-capacity box is the stacking check in
  // `packOneLevel` below, which applies regardless of arrival order.
  let remaining = [...boxes].sort((a, b) => b.heightCm - a.heightCm || b.weightKg - a.weightKg);
  const placedThisTruck: { box: PackBox; x: number; y: number; z: number }[] = [];
  let z = 0;
  // `null` = ground floor, which can always bear weight — no stacking
  // check applies to the very first level.
  let supportBelow: SupportEntry[] | null = null;

  while (remaining.length > 0 && z < truck.heightCm) {
    const level = packOneLevel(remaining, truck.lengthCm, truck.widthCm, supportBelow);
    if (level.placed.length === 0) break; // shouldn't happen when every box individually fits the envelope — guards against an infinite loop
    if (z + level.levelHeightCm > truck.heightCm) {
      // This level doesn't fit height-wise at all — everything in it overflows.
      remaining = [...level.placed.map((p) => p.box), ...level.unplaced];
      break;
    }
    for (const p of level.placed) placedThisTruck.push({ box: p.box, x: p.x, y: p.y, z });
    z += level.levelHeightCm;
    remaining = level.unplaced;
    supportBelow = level.placed.map((p) => ({
      x: p.x,
      y: p.y,
      lengthCm: p.box.lengthCm,
      widthCm: p.box.widthCm,
      stackable: p.box.stackable,
      remainingCapacityKg: p.box.stackable ? (p.box.maxStackWeightKg ?? Infinity) : 0,
    }));
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
export interface StrapPlan {
  /** Number of tie-down straps recommended for this truck's load. */
  count: number;
  /** Approximate length of a single strap, cm — enough to run from one side rail, up and over the stack, down to the opposite rail, plus slack for the buckle/tensioner. */
  lengthCm: number;
  /** Where along the truck's length (X, cm from the front) each strap should cross — snapped to a natural gap between boxes when one exists nearby, so the strap doesn't have to rest directly on a box's top edge. */
  positionsCm: number[];
}

const STRAP_INTERVAL_CM = 150;
const STRAP_SLACK_CM = 60;
const STRAP_GAP_SNAP_CM = 40;
const STRAP_MIN_GAP_WIDTH_CM = 3;

/**
 * "потрібно щоб враховувало стропи ремені як привязувати в фурі" (2026-10-28)
 * — a real tie-down doesn't need horizontal clearance from the side walls
 * (it runs from the anchor rail straight up and over the stack, same as any
 * curtain-side/flatbed load), so this doesn't touch the packing geometry
 * above. What it DOES need is: how many straps, how long, and — ideally —
 * landing in a clear gap between boxes along the truck's length rather than
 * resting on a box's own top edge. A straight rule-of-thumb heuristic
 * (one strap per ~1.5m of load length, minimum 2 so a short load is still
 * secured at both ends), not a load-rating calculation — same honest
 * "practical, not a physics engine" tradeoff as the bin-packing above.
 */
export function computeStrapPlan(placed: PlacedBox[], truck: TruckDims): StrapPlan | null {
  if (placed.length === 0) return null;

  const loadLengthCm = Math.max(...placed.map((b) => b.x + b.lengthCm));
  const loadHeightCm = Math.max(...placed.map((b) => b.z + b.heightCm));
  const count = Math.max(2, Math.ceil(loadLengthCm / STRAP_INTERVAL_CM));

  // Union of every box's X-span (any height level) — an X inside this union
  // has a box somewhere along its vertical drop; only X outside it is a
  // clear gap a strap can pass straight down through to the floor.
  const sortedSpans = placed.map((b): [number, number] => [b.x, b.x + b.lengthCm]).sort((a, b) => a[0] - b[0]);
  const occupied: [number, number][] = [];
  for (const [start, end] of sortedSpans) {
    const last = occupied[occupied.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else occupied.push([start, end]);
  }
  const gaps = occupied
    .slice(1)
    .map((span, i): [number, number] => [occupied[i][1], span[0]])
    .filter(([start, end]) => end - start >= STRAP_MIN_GAP_WIDTH_CM);

  const positionsCm = Array.from({ length: count }, (_, i) => {
    const ideal = ((i + 0.5) / count) * loadLengthCm;
    let best = ideal;
    let bestDist = STRAP_GAP_SNAP_CM;
    for (const [gapStart, gapEnd] of gaps) {
      const gapCenter = (gapStart + gapEnd) / 2;
      const dist = Math.abs(gapCenter - ideal);
      if (dist < bestDist) {
        bestDist = dist;
        best = gapCenter;
      }
    }
    return Math.round(best * 10) / 10;
  });

  return { count, lengthCm: Math.round(2 * loadHeightCm + truck.widthCm + STRAP_SLACK_CM), positionsCm };
}

function packOneLevel(
  boxes: PackBox[],
  floorLengthCm: number,
  floorWidthCm: number,
  supportBelow: SupportEntry[] | null,
): { placed: { box: PackBox; x: number; y: number }[]; unplaced: PackBox[]; levelHeightCm: number } {
  const placed: { box: PackBox; x: number; y: number }[] = [];
  const unplaced: PackBox[] = [];
  let x = 0;
  let y = 0;
  let rowDepth = 0;
  let levelHeightCm = 0;
  let rowAssemblyId: string | null = null;

  for (const box of boxes) {
    // "чому воно розкладає не логічно" (2026-10-29) — found live: 3 copies
    // of the same assembly ended up split, 2 in one row and 1 tacked onto
    // the tail of an unrelated, much longer item's row, just because that
    // leftover length happened to fit it. Geometrically optimal, but no
    // warehouse worker would actually load it that way — identical items
    // belong together, easier to find, strap, and unload as one group.
    // Forcing a row break whenever the next box is a DIFFERENT assembly
    // than the one already occupying this row (not just on a pure length
    // overflow) keeps every row single-SKU, at the cost of some wasted
    // leftover length in a row that ends before the floor's own edge —
    // the same "practical over optimal" tradeoff this whole module
    // already makes elsewhere.
    const rowFull = x + box.lengthCm > floorLengthCm;
    const rowSwitchesAssembly = x > 0 && rowAssemblyId !== null && box.assemblyId !== rowAssemblyId;
    if (rowFull || rowSwitchesAssembly) {
      x = 0;
      y += rowDepth;
      rowDepth = 0;
      rowAssemblyId = null;
    }
    if (y + box.widthCm > floorWidthCm) {
      unplaced.push(box);
      continue;
    }

    if (supportBelow !== null) {
      const supports = supportBelow.filter((s) => footprintsOverlap({ x, y, lengthCm: box.lengthCm, widthCm: box.widthCm }, s));
      // No support directly underneath at this position (shouldn't happen
      // given this level's floor is only ever as large as the level
      // below's own footprint, but guarded anyway), or something it would
      // rest on can't bear it (not stackable, or out of weight budget) —
      // this box doesn't get a legal resting spot here. Pushed to
      // `unplaced` exactly like a width-overflowing box above: it may
      // still find a spot in a LATER level (different footprint), or ends
      // up in `overflow` for the next truck if it never does.
      const hasIllegalSupport = supports.length === 0 || supports.some((s) => !s.stackable || s.remainingCapacityKg < box.weightKg);
      if (hasIllegalSupport) {
        unplaced.push(box);
        continue;
      }
      for (const s of supports) s.remainingCapacityKg -= box.weightKg;
    }

    placed.push({ box, x, y });
    x += box.lengthCm;
    rowDepth = Math.max(rowDepth, box.widthCm);
    levelHeightCm = Math.max(levelHeightCm, box.heightCm);
    rowAssemblyId = box.assemblyId;
  }

  return { placed, unplaced, levelHeightCm };
}
