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
