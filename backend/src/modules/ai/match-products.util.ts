import type { Product } from '@prisma/client';

/** One extracted/candidate BOM line, fuzzy-matched against the company's real catalog. Shared response shape across every extraction source (AI-read drawing, STEP assembly structure) — a reviewer doesn't need to know which source produced a given line. */
export interface MatchedBomLine {
  rawName: string;
  qty: number;
  dimensions: string | null;
  matched: boolean;
  article: string;
  matchedName: string;
  productId: string;
  /** Розкрій (2026-10-31): structured bounding-box numbers from the STEP path only — null for the PDF/AI path (free-text `dimensions` only, unreliable to parse). Lets the review page prefill cutLengthCm/cutWidthCm when the matched/created product has a ProductCuttingSpec. */
  lengthCm: number | null;
  widthCm: number | null;
  /** Irregular-shape nesting (2026-11-01): the part's real contour, STEP path only — null when unavailable (PDF/AI path, or a curved/non-flat STEP part with no clean planar face). Saved verbatim as AssemblyComponent.cutShapePolygon when present. */
  shapePolygon: { outerCm: [number, number][]; holesCm: [number, number][][] } | null;
}

/**
 * Exact-then-substring case-insensitive match against a company's Product
 * catalog — extracted from `AiService.recognizeInvoice`'s original inline
 * logic (2026-10-31) so the new drawing/STEP BOM-extraction paths reuse the
 * identical matching behavior instead of a third copy. `recognizeInvoice`
 * itself is left as-is (out of scope for this change) but could adopt this
 * helper later.
 */
export function matchProductByName(rawName: string, products: Product[]): Product | undefined {
  const rawLower = rawName.toLowerCase();
  let match = products.find((p) => p.name.toLowerCase() === rawLower);
  if (!match) {
    match = products.find((p) => rawLower.length > 3 && (p.name.toLowerCase().includes(rawLower) || rawLower.includes(p.name.toLowerCase())));
  }
  return match;
}

export function toMatchedBomLine(
  rawName: string,
  qty: number,
  dimensions: string | null,
  products: Product[],
  lengthCm: number | null = null,
  widthCm: number | null = null,
  shapePolygon: { outerCm: [number, number][]; holesCm: [number, number][][] } | null = null,
): MatchedBomLine {
  const match = matchProductByName(rawName, products);
  return {
    rawName,
    qty,
    dimensions,
    matched: !!match,
    article: match ? match.article : '',
    matchedName: match ? match.name : '',
    productId: match ? match.id : '',
    lengthCm,
    widthCm,
    shapePolygon,
  };
}
