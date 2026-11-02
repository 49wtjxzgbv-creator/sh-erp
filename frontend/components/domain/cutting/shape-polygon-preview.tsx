/** Builds an SVG path `d` string for a polygon with holes (even-odd fill rule punches the holes out) — one `M...Z` ring per outer/hole loop. Shared between the full sheet-nesting diagram (cutting-plan-detail.tsx) and this file's own small upload-time preview — one real implementation, not two copies. */
export function polygonToPathD(outerCm: [number, number][], holesCm: [number, number][][]): string {
  const ring = (pts: [number, number][]) => `M ${pts.map(([x, y]) => `${x},${y}`).join(' L ')} Z`;
  return [ring(outerCm), ...holesCm.map(ring)].join(' ');
}

function boundingBox(outerCm: [number, number][]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of outerCm) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

export interface ShapePolygonPreviewProps {
  outerCm: [number, number][];
  holesCm: [number, number][][];
  className?: string;
}

/**
 * Small inline thumbnail of an extracted piece's real contour — "передогляд
 * завантаженого файлу" (2026-11-01): right after a STEP/DXF upload, show
 * what was actually parsed, not just the length/width numbers next to the
 * "Форма з файлу" badge. `viewBox` is fit to the polygon's own bounding box
 * (with a small margin) rather than a full sheet, since this is a one-piece
 * preview, not a nesting layout.
 */
export function ShapePolygonPreview({ outerCm, holesCm, className }: ShapePolygonPreviewProps) {
  if (outerCm.length < 3) return null;
  const { minX, minY, width, height } = boundingBox(outerCm);
  if (width <= 0 || height <= 0) return null;
  const margin = Math.max(width, height) * 0.08;

  return (
    <svg
      viewBox={`${minX - margin} ${minY - margin} ${width + margin * 2} ${height + margin * 2}`}
      className={className ?? 'h-20 w-20 rounded border border-border bg-muted'}
    >
      <path d={polygonToPathD(outerCm, holesCm)} fillRule="evenodd" className="fill-primary/70" stroke="white" strokeWidth={Math.max(width, height) / 100} />
    </svg>
  );
}
