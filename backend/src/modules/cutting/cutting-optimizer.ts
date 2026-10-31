import { CodedBadRequestException } from '../../common/api-exceptions';

/**
 * Cutting-stock optimization (розкрій, 2026-10-31) — deliberately practical
 * heuristics, not an exact ILP solver for the NP-hard cutting-stock problem,
 * same honest tradeoff `load-plan-packing.ts` already makes for 3D bin
 * packing. Pure functions, no Prisma/DI, trivially unit-testable.
 *
 * Both functions below prefer consuming already-available `StockRemnant`
 * pieces (smallest-sufficient first — best-fit) before opening a fresh
 * standard-length bar/sheet, so a cutting plan naturally shrinks the next
 * purchase as leftover offcuts accumulate. Kerf (saw/blade loss) is charged
 * per piece cut from a given stock item — a deliberately conservative
 * over-estimate rather than the more precise "kerf only between adjacent
 * cuts," kept simple and safe on the side of slightly over-buying rather
 * than under-buying.
 */

export interface BarDemandLine {
  /** Caller-supplied label carried through untouched into the cut output (e.g. an AssemblyComponent reference) — the algorithm never interprets it. */
  label: string;
  lengthCm: number;
  qty: number;
}

export interface AvailableBarRemnant {
  remnantId: string;
  lengthCm: number;
}

export interface BarCutPiece {
  label: string;
  pieceLengthCm: number;
}

export interface BarStockItem {
  sourceKind: 'FRESH' | 'REMNANT';
  remnantId: string | null;
  lengthCm: number;
  cuts: BarCutPiece[];
  /** What's left on this stock item after every cut (and its kerf) — the caller decides whether this clears the product's minRemnantLengthCm threshold and should become a new StockRemnant. */
  leftoverLengthCm: number;
}

export interface BarCuttingPlan {
  stockItems: BarStockItem[];
  freshBarsUsed: number;
  remnantsUsed: string[];
}

export function optimizeBarCutting(demand: BarDemandLine[], stockLengthCm: number, kerfMm: number, availableRemnants: AvailableBarRemnant[]): BarCuttingPlan {
  const kerfCm = kerfMm / 10;

  const pieces: { label: string; lengthCm: number }[] = [];
  for (const line of demand) {
    for (let i = 0; i < line.qty; i++) pieces.push({ label: line.label, lengthCm: line.lengthCm });
  }
  pieces.sort((a, b) => b.lengthCm - a.lengthCm);

  interface OpenBin {
    sourceKind: 'FRESH' | 'REMNANT';
    remnantId: string | null;
    lengthCm: number;
    remainingCm: number;
    cuts: BarCutPiece[];
  }
  const openBins: OpenBin[] = [];
  const unusedRemnants = [...availableRemnants].sort((a, b) => a.lengthCm - b.lengthCm);

  for (const piece of pieces) {
    const requiredCm = piece.lengthCm + kerfCm;

    // 1. Fit into an already-open bin — remnant-sourced bins first, then
    // best-fit (least remaining capacity after placing) among the rest.
    const candidates = openBins.filter((b) => b.remainingCm >= requiredCm);
    candidates.sort((a, b) => {
      if (a.sourceKind !== b.sourceKind) return a.sourceKind === 'REMNANT' ? -1 : 1;
      return a.remainingCm - b.remainingCm;
    });
    if (candidates.length > 0) {
      const bin = candidates[0];
      bin.remainingCm -= requiredCm;
      bin.cuts.push({ label: piece.label, pieceLengthCm: piece.lengthCm });
      continue;
    }

    // 2. Open a new bin from the smallest sufficient unused remnant.
    const remnantIdx = unusedRemnants.findIndex((r) => r.lengthCm >= requiredCm);
    if (remnantIdx !== -1) {
      const remnant = unusedRemnants.splice(remnantIdx, 1)[0];
      openBins.push({
        sourceKind: 'REMNANT',
        remnantId: remnant.remnantId,
        lengthCm: remnant.lengthCm,
        remainingCm: remnant.lengthCm - requiredCm,
        cuts: [{ label: piece.label, pieceLengthCm: piece.lengthCm }],
      });
      continue;
    }

    // 3. Open a fresh standard-length bar.
    if (requiredCm > stockLengthCm) {
      throw new CodedBadRequestException(
        'CUTTING_PIECE_TOO_LONG',
        `Потрібна довжина ${piece.lengthCm} см (+ запил) не поміщається навіть у нову штангу довжиною ${stockLengthCm} см.`,
      );
    }
    openBins.push({
      sourceKind: 'FRESH',
      remnantId: null,
      lengthCm: stockLengthCm,
      remainingCm: stockLengthCm - requiredCm,
      cuts: [{ label: piece.label, pieceLengthCm: piece.lengthCm }],
    });
  }

  return {
    stockItems: openBins.map((b) => ({
      sourceKind: b.sourceKind,
      remnantId: b.remnantId,
      lengthCm: b.lengthCm,
      cuts: b.cuts,
      leftoverLengthCm: Math.max(0, b.remainingCm),
    })),
    freshBarsUsed: openBins.filter((b) => b.sourceKind === 'FRESH').length,
    remnantsUsed: openBins.filter((b) => b.sourceKind === 'REMNANT').map((b) => b.remnantId!),
  };
}

export interface SheetDemandLine {
  /** Caller-supplied label carried through untouched into the cut output. */
  label: string;
  widthCm: number;
  heightCm: number;
  qty: number;
}

export interface AvailableSheetRemnant {
  remnantId: string;
  lengthCm: number;
  widthCm: number;
}

export interface SheetCutPiece {
  label: string;
  pieceLengthCm: number;
  pieceWidthCm: number;
  posXCm: number;
  posYCm: number;
  rotated: boolean;
}

export interface SheetStockItem {
  sourceKind: 'FRESH' | 'REMNANT';
  remnantId: string | null;
  lengthCm: number;
  widthCm: number;
  cuts: SheetCutPiece[];
  /** A clean, honest-but-conservative leftover rectangle — the unused strip running the sheet's full length, from the last packed row to the sheet's far edge. Real unused floor space is usually larger (gaps within rows), ignored here on purpose — same "practical over optimal" tradeoff as the bar algorithm's leftover accounting. */
  leftoverLengthCm: number;
  leftoverWidthCm: number;
}

export interface SheetNestingPlan {
  stockItems: SheetStockItem[];
  freshSheetsUsed: number;
  remnantsUsed: string[];
}

export function optimizeSheetNesting(
  demand: SheetDemandLine[],
  stockLengthCm: number,
  stockWidthCm: number,
  kerfMm: number,
  availableRemnants: AvailableSheetRemnant[],
  allowRotation: boolean,
): SheetNestingPlan {
  const kerfCm = kerfMm / 10;

  const pieces: { label: string; widthCm: number; heightCm: number }[] = [];
  for (const line of demand) {
    for (let i = 0; i < line.qty; i++) pieces.push({ label: line.label, widthCm: line.widthCm, heightCm: line.heightCm });
  }
  // Biggest footprint first — standard shelf-packing heuristic (same as
  // load-plan-packing.ts's height-first sort).
  pieces.sort((a, b) => Math.max(b.widthCm, b.heightCm) - Math.max(a.widthCm, a.heightCm));

  interface OpenBin {
    sourceKind: 'FRESH' | 'REMNANT';
    remnantId: string | null;
    lengthCm: number;
    widthCm: number;
    x: number;
    y: number;
    rowDepth: number;
    cuts: SheetCutPiece[];
  }

  function tryPlace(bin: OpenBin, piece: { label: string; widthCm: number; heightCm: number }): boolean {
    const orientations: { w: number; h: number; rotated: boolean }[] = [{ w: piece.widthCm, h: piece.heightCm, rotated: false }];
    if (allowRotation) orientations.push({ w: piece.heightCm, h: piece.widthCm, rotated: true });

    // Try the current row first (no new row needed), then try starting a
    // fresh row — in both cases preferring the first orientation (normal)
    // that fits.
    for (const startNewRow of [false, true]) {
      const x = startNewRow ? 0 : bin.x;
      const y = startNewRow ? bin.y + bin.rowDepth : bin.y;
      for (const o of orientations) {
        const effW = o.w + kerfCm;
        const effH = o.h + kerfCm;
        if (x + effW <= bin.lengthCm && y + effH <= bin.widthCm) {
          bin.cuts.push({ label: piece.label, pieceLengthCm: o.w, pieceWidthCm: o.h, posXCm: x, posYCm: y, rotated: o.rotated });
          bin.x = x + effW;
          bin.y = y;
          bin.rowDepth = startNewRow ? effH : Math.max(bin.rowDepth, effH);
          return true;
        }
      }
    }
    return false;
  }

  function fitsBin(binLengthCm: number, binWidthCm: number, piece: { widthCm: number; heightCm: number }): boolean {
    const normal = piece.widthCm + kerfCm <= binLengthCm && piece.heightCm + kerfCm <= binWidthCm;
    const rotated = allowRotation && piece.heightCm + kerfCm <= binLengthCm && piece.widthCm + kerfCm <= binWidthCm;
    return normal || rotated;
  }

  const openBins: OpenBin[] = [];
  const unusedRemnants = [...availableRemnants].sort((a, b) => a.lengthCm * a.widthCm - b.lengthCm * b.widthCm);

  for (const piece of pieces) {
    const sortedOpenBins = [...openBins].sort((a, b) => (a.sourceKind === b.sourceKind ? 0 : a.sourceKind === 'REMNANT' ? -1 : 1));
    const placedInOpenBin = sortedOpenBins.some((bin) => tryPlace(bin, piece));
    if (placedInOpenBin) continue;

    const remnantIdx = unusedRemnants.findIndex((r) => fitsBin(r.lengthCm, r.widthCm, piece));
    if (remnantIdx !== -1) {
      const remnant = unusedRemnants.splice(remnantIdx, 1)[0];
      const bin: OpenBin = { sourceKind: 'REMNANT', remnantId: remnant.remnantId, lengthCm: remnant.lengthCm, widthCm: remnant.widthCm, x: 0, y: 0, rowDepth: 0, cuts: [] };
      openBins.push(bin);
      tryPlace(bin, piece);
      continue;
    }

    if (!fitsBin(stockLengthCm, stockWidthCm, piece)) {
      throw new CodedBadRequestException(
        'CUTTING_PIECE_TOO_LARGE',
        `Деталь ${piece.widthCm}×${piece.heightCm} см не поміщається навіть у новий лист ${stockLengthCm}×${stockWidthCm} см.`,
      );
    }
    const bin: OpenBin = { sourceKind: 'FRESH', remnantId: null, lengthCm: stockLengthCm, widthCm: stockWidthCm, x: 0, y: 0, rowDepth: 0, cuts: [] };
    openBins.push(bin);
    tryPlace(bin, piece);
  }

  return {
    stockItems: openBins.map((b) => {
      const usedWidthCm = b.y + b.rowDepth;
      const leftoverWidthCm = Math.max(0, b.widthCm - usedWidthCm);
      return {
        sourceKind: b.sourceKind,
        remnantId: b.remnantId,
        lengthCm: b.lengthCm,
        widthCm: b.widthCm,
        cuts: b.cuts,
        leftoverLengthCm: leftoverWidthCm > 0 ? b.lengthCm : 0,
        leftoverWidthCm,
      };
    }),
    freshSheetsUsed: openBins.filter((b) => b.sourceKind === 'FRESH').length,
    remnantsUsed: openBins.filter((b) => b.sourceKind === 'REMNANT').map((b) => b.remnantId!),
  };
}

// ----------------------------------------------------------------------------
// Irregular-shape (polygon) nesting (2026-11-01) — "довільні форми з дугами/
// отворами по контуру" (arbitrary shapes with arcs/holes on the contour,
// arcs already tessellated into line segments upstream by
// step-extract-bom-child.js's boundary trace before reaching here). A true
// optimal nester (no-fit-polygon) is a multi-year research field on its
// own; this is a grid/raster placement engine instead — a well-established,
// honest practical technique (real laser/plasma nesting tools use it when
// true NFP is too complex): rasterize each sheet as an occupancy grid,
// rasterize each piece's real contour (holes excluded from the mask — they
// don't block OTHER pieces, kept only for the output shape/rendering), try
// each axis-aligned rotation, first position with zero collision wins. Grid
// resolution trades precision for speed; kerf becomes a mask dilation.
//
// Deliberately a SEPARATE function from optimizeSheetNesting above, not a
// generalization of it — that function's shelf-pack is exact, fast, and
// already shipped/tested for the common simple-rectangle case; this one
// only ever runs for a material group where at least one component has a
// real stored contour (CuttingPlansService decides which to call).
// ----------------------------------------------------------------------------

export type Point2D = [number, number];

export interface IrregularSheetDemandLine {
  /** Caller-supplied label carried through untouched into the cut output. */
  label: string;
  outerCm: Point2D[];
  holesCm: Point2D[][];
  qty: number;
}

export interface AvailableIrregularSheetRemnant {
  remnantId: string;
  lengthCm: number;
  widthCm: number;
}

export interface IrregularSheetCutPiece {
  label: string;
  /** The piece's real contour, already translated+rotated into the sheet's own coordinate frame. */
  outerCm: Point2D[];
  holesCm: Point2D[][];
  /** Bounding box of the placed piece — mirrors the rectangle path's pieceLengthCm/pieceWidthCm/posXCm/posYCm for display/back-compat. */
  boundingLengthCm: number;
  boundingWidthCm: number;
  posXCm: number;
  posYCm: number;
  rotated: boolean;
}

export interface IrregularSheetStockItem {
  sourceKind: 'FRESH' | 'REMNANT';
  remnantId: string | null;
  lengthCm: number;
  widthCm: number;
  cuts: IrregularSheetCutPiece[];
  usedAreaCm2: number;
  wasteAreaCm2: number;
}

export interface IrregularSheetNestingPlan {
  stockItems: IrregularSheetStockItem[];
  freshSheetsUsed: number;
  remnantsUsed: string[];
}

function polygonBounds(poly: Point2D[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function polygonArea(poly: Point2D[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum / 2);
}

/** Rotates a polygon by `quarterTurns` × 90° about the origin — the only rotations this engine supports (matches the existing rectangle path's `allowRotation` convention; arbitrary-angle rotation is out of scope). */
function rotatePolygon(poly: Point2D[], quarterTurns: 0 | 1 | 2 | 3): Point2D[] {
  return poly.map(([x, y]): Point2D => {
    switch (quarterTurns) {
      case 0:
        return [x, y];
      case 1:
        return [-y, x];
      case 2:
        return [-x, -y];
      case 3:
        return [y, -x];
    }
  });
}

/** Translates a polygon so its bounding box's min corner sits at (0, 0) — a normalized "local" frame, ready to rasterize or re-translate onto a sheet. */
function normalizeToOrigin(poly: Point2D[]): { poly: Point2D[]; bounds: ReturnType<typeof polygonBounds> } {
  const bounds = polygonBounds(poly);
  return { poly: poly.map(([x, y]): Point2D => [x - bounds.minX, y - bounds.minY]), bounds };
}

function pointInPolygon(x: number, y: number, poly: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygonWithHoles(x: number, y: number, outer: Point2D[], holes: Point2D[][]): boolean {
  if (!pointInPolygon(x, y, outer)) return false;
  for (const hole of holes) if (pointInPolygon(x, y, hole)) return false;
  return true;
}

/** A piece's occupied-cell mask (local grid coordinates, [0,0] = its own bounding box's min corner) — kerf margin folded in as a simple morphological dilation, since a sub-cell kerf value can't be expressed as a polygon offset at grid resolution anyway. */
function rasterizePiece(outer: Point2D[], holes: Point2D[][], resCm: number, kerfMm: number): { cells: boolean[][]; rows: number; cols: number } {
  const bounds = polygonBounds(outer);
  const cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / resCm));
  const rows = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) / resCm));

  const raw: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = bounds.minX + (c + 0.5) * resCm;
      const y = bounds.minY + (r + 0.5) * resCm;
      raw[r][c] = pointInPolygonWithHoles(x, y, outer, holes);
    }
  }

  const dilateCells = Math.ceil(kerfMm / 10 / 2 / resCm);
  if (dilateCells <= 0) return { cells: raw, rows, cols };

  const dilated: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!raw[r][c]) continue;
      for (let dr = -dilateCells; dr <= dilateCells; dr++) {
        for (let dc = -dilateCells; dc <= dilateCells; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) dilated[rr][cc] = true;
        }
      }
    }
  }
  return { cells: dilated, rows, cols };
}

interface OpenIrregularBin {
  sourceKind: 'FRESH' | 'REMNANT';
  remnantId: string | null;
  lengthCm: number;
  widthCm: number;
  occupied: boolean[][]; // [row][col], row = Y axis, col = X axis
  rows: number;
  cols: number;
  cuts: IrregularSheetCutPiece[];
}

function tryPlaceInBin(bin: OpenIrregularBin, piece: { label: string; outerCm: Point2D[]; holesCm: Point2D[][] }, resCm: number, kerfMm: number, allowRotation: boolean): boolean {
  const orientations: { quarterTurns: 0 | 1 | 2 | 3; rotated: boolean }[] = allowRotation
    ? [
        { quarterTurns: 0, rotated: false },
        { quarterTurns: 1, rotated: true },
        { quarterTurns: 2, rotated: true },
        { quarterTurns: 3, rotated: true },
      ]
    : [{ quarterTurns: 0, rotated: false }];

  for (const { quarterTurns, rotated } of orientations) {
    const rotatedOuter = rotatePolygon(piece.outerCm, quarterTurns);
    const rotatedHoles = piece.holesCm.map((h) => rotatePolygon(h, quarterTurns));
    const { poly: localOuter, bounds } = normalizeToOrigin(rotatedOuter);
    const localHoles = rotatedHoles.map((h) => h.map(([x, y]): Point2D => [x - bounds.minX, y - bounds.minY]));

    const { cells: mask, rows: pieceRows, cols: pieceCols } = rasterizePiece(localOuter, localHoles, resCm, kerfMm);
    if (pieceRows > bin.rows || pieceCols > bin.cols) continue; // can't possibly fit this orientation

    for (let anchorRow = 0; anchorRow <= bin.rows - pieceRows; anchorRow++) {
      for (let anchorCol = 0; anchorCol <= bin.cols - pieceCols; anchorCol++) {
        let collision = false;
        for (let r = 0; r < pieceRows && !collision; r++) {
          for (let c = 0; c < pieceCols; c++) {
            if (mask[r][c] && bin.occupied[anchorRow + r][anchorCol + c]) {
              collision = true;
              break;
            }
          }
        }
        if (collision) continue;

        // Commit: mark occupied, translate the real (un-rasterized) contour to this anchor position.
        for (let r = 0; r < pieceRows; r++) {
          for (let c = 0; c < pieceCols; c++) {
            if (mask[r][c]) bin.occupied[anchorRow + r][anchorCol + c] = true;
          }
        }
        const posXCm = anchorCol * resCm;
        const posYCm = anchorRow * resCm;
        const placedOuter = localOuter.map(([x, y]): Point2D => [x + posXCm, y + posYCm]);
        const placedHoles = localHoles.map((h) => h.map(([x, y]): Point2D => [x + posXCm, y + posYCm]));
        bin.cuts.push({
          label: piece.label,
          outerCm: placedOuter,
          holesCm: placedHoles,
          boundingLengthCm: bounds.maxX - bounds.minX,
          boundingWidthCm: bounds.maxY - bounds.minY,
          posXCm,
          posYCm,
          rotated,
        });
        return true;
      }
    }
  }
  return false;
}

export function optimizeIrregularSheetNesting(
  demand: IrregularSheetDemandLine[],
  stockLengthCm: number,
  stockWidthCm: number,
  kerfMm: number,
  availableRemnants: AvailableIrregularSheetRemnant[],
  allowRotation: boolean,
  gridResolutionCm = 1,
): IrregularSheetNestingPlan {
  const pieces: { label: string; outerCm: Point2D[]; holesCm: Point2D[][] }[] = [];
  for (const line of demand) {
    for (let i = 0; i < line.qty; i++) pieces.push({ label: line.label, outerCm: line.outerCm, holesCm: line.holesCm });
  }
  // Biggest footprint first — same shelf-packing heuristic the rectangle path already uses.
  pieces.sort((a, b) => {
    const ba = polygonBounds(a.outerCm);
    const bb = polygonBounds(b.outerCm);
    return (bb.maxX - bb.minX) * (bb.maxY - bb.minY) - (ba.maxX - ba.minX) * (ba.maxY - ba.minY);
  });

  function newBin(sourceKind: 'FRESH' | 'REMNANT', remnantId: string | null, lengthCm: number, widthCm: number): OpenIrregularBin {
    const cols = Math.max(1, Math.ceil(lengthCm / gridResolutionCm));
    const rows = Math.max(1, Math.ceil(widthCm / gridResolutionCm));
    return { sourceKind, remnantId, lengthCm, widthCm, occupied: Array.from({ length: rows }, () => new Array(cols).fill(false)), rows, cols, cuts: [] };
  }

  function fitsBin(lengthCm: number, widthCm: number, piece: { outerCm: Point2D[] }): boolean {
    const b = polygonBounds(piece.outerCm);
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    const normal = w <= lengthCm && h <= widthCm;
    const rotated = allowRotation && h <= lengthCm && w <= widthCm;
    return normal || rotated;
  }

  const openBins: OpenIrregularBin[] = [];
  const unusedRemnants = [...availableRemnants].sort((a, b) => a.lengthCm * a.widthCm - b.lengthCm * b.widthCm);

  for (const piece of pieces) {
    const sortedOpenBins = [...openBins].sort((a, b) => (a.sourceKind === b.sourceKind ? 0 : a.sourceKind === 'REMNANT' ? -1 : 1));
    const placedInOpenBin = sortedOpenBins.some((bin) => tryPlaceInBin(bin, piece, gridResolutionCm, kerfMm, allowRotation));
    if (placedInOpenBin) continue;

    const remnantIdx = unusedRemnants.findIndex((r) => fitsBin(r.lengthCm, r.widthCm, piece));
    if (remnantIdx !== -1) {
      const remnant = unusedRemnants.splice(remnantIdx, 1)[0];
      const bin = newBin('REMNANT', remnant.remnantId, remnant.lengthCm, remnant.widthCm);
      openBins.push(bin);
      if (!tryPlaceInBin(bin, piece, gridResolutionCm, kerfMm, allowRotation)) {
        throw new CodedBadRequestException('CUTTING_PIECE_TOO_LARGE', `Деталь не вдалося розмістити навіть на новому залишку ${remnant.lengthCm}×${remnant.widthCm} см.`);
      }
      continue;
    }

    if (!fitsBin(stockLengthCm, stockWidthCm, piece)) {
      throw new CodedBadRequestException('CUTTING_PIECE_TOO_LARGE', `Деталь не поміщається навіть у новий лист ${stockLengthCm}×${stockWidthCm} см.`);
    }
    const bin = newBin('FRESH', null, stockLengthCm, stockWidthCm);
    openBins.push(bin);
    if (!tryPlaceInBin(bin, piece, gridResolutionCm, kerfMm, allowRotation)) {
      throw new CodedBadRequestException('CUTTING_PIECE_TOO_LARGE', `Деталь не вдалося розмістити навіть на новому листі ${stockLengthCm}×${stockWidthCm} см.`);
    }
  }

  return {
    stockItems: openBins.map((b) => {
      const usedAreaCm2 = b.cuts.reduce((sum, c) => sum + polygonArea(c.outerCm) - c.holesCm.reduce((hs, h) => hs + polygonArea(h), 0), 0);
      const totalAreaCm2 = b.lengthCm * b.widthCm;
      return {
        sourceKind: b.sourceKind,
        remnantId: b.remnantId,
        lengthCm: b.lengthCm,
        widthCm: b.widthCm,
        cuts: b.cuts,
        usedAreaCm2: Math.round(usedAreaCm2 * 100) / 100,
        wasteAreaCm2: Math.round((totalAreaCm2 - usedAreaCm2) * 100) / 100,
      };
    }),
    freshSheetsUsed: openBins.filter((b) => b.sourceKind === 'FRESH').length,
    remnantsUsed: openBins.filter((b) => b.sourceKind === 'REMNANT').map((b) => b.remnantId!),
  };
}
