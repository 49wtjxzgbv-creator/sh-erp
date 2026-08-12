import type { IDxf, IEntity, IInsertEntity, ILineEntity, ILwpolylineEntity, IPolylineEntity, ICircleEntity, IArcEntity, IEllipseEntity, ISplineEntity, IPointEntity } from 'dxf-parser';

/**
 * Pure geometry extraction shared between `dxf-2d-viewer.tsx` (which only
 * renders) and `dxf-parser.worker.ts` (which does the actual parsing +
 * extraction off the main thread — see that worker's header comment for
 * why this can't run inline).
 */
export interface Pt {
  x: number;
  y: number;
}

export interface Segment {
  points: Pt[];
  color: string | null;
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** DXF header variable `$INSUNITS` (group 70) — only the drawing units actually seen from real shop files so far; anything else (0/unset/astronomical units etc.) is left unlabeled rather than guessed. */
const INSUNITS_LABELS: Record<number, string> = {
  1: 'in',
  2: 'ft',
  4: 'mm',
  5: 'cm',
  6: 'm',
  10: 'yd',
};

export function resolveUnitLabel(dxf: IDxf): string | null {
  const raw = dxf.header?.['$INSUNITS'];
  return typeof raw === 'number' ? (INSUNITS_LABELS[raw] ?? null) : null;
}

export function computeBoundingBox(segments: Segment[]): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const seg of segments) {
    for (const p of seg.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Geometry-only preview: LINE/LWPOLYLINE/POLYLINE (bulge segments expanded
 * into arcs)/CIRCLE/ARC/ELLIPSE/SPLINE/POINT/INSERT (block references,
 * flattened with position/rotation/scale/array-copy) are drawn; TEXT,
 * MTEXT, DIMENSION, HATCH, SOLID and 3DFACE are silently skipped — this is
 * "what does this part look like", not a full CAD viewer, and skipping
 * text avoids pulling in a font-rendering dependency for it.
 */
export function extractSegments(dxf: IDxf): Segment[] {
  const segments: Segment[] = [];
  const blocksByName = dxf.blocks ?? {};
  const onStack = new Set<string>();

  function colorFor(entity: IEntity): string | null {
    // `entity.color` is a resolved 24-bit RGB int only when the entity carries an explicit true color (DXF
    // code 420). `colorIndex` 256 ("ByLayer") / 0 ("ByBlock") aren't resolved against the LAYER table by
    // dxf-parser, so anything else falls back to the default stroke rather than guessing a color.
    if (typeof entity.color === 'number' && entity.color > 0) return `#${entity.color.toString(16).padStart(6, '0')}`;
    return null;
  }

  function pushPolyline(points: Pt[], color: string | null) {
    if (points.length >= 2) segments.push({ points, color });
  }

  function visitEntities(entities: IEntity[], transform: (p: Pt) => Pt, depth: number) {
    if (depth > 8) return; // guards against pathological block nesting
    for (const entity of entities) {
      const color = colorFor(entity);
      switch (entity.type) {
        case 'LINE': {
          const e = entity as ILineEntity;
          pushPolyline(e.vertices.map(transform), color);
          break;
        }
        case 'LWPOLYLINE': {
          const e = entity as ILwpolylineEntity;
          pushPolyline(polylineToPoints(e.vertices, Boolean(e.shape)).map(transform), color);
          break;
        }
        case 'POLYLINE': {
          const e = entity as IPolylineEntity;
          pushPolyline(polylineToPoints(e.vertices, Boolean(e.shape)).map(transform), color);
          break;
        }
        case 'CIRCLE': {
          const e = entity as ICircleEntity;
          pushPolyline(arcToPoints(e.center, e.radius, 0, Math.PI * 2, 64).map(transform), color);
          break;
        }
        case 'ARC': {
          const e = entity as IArcEntity;
          pushPolyline(arcToPoints(e.center, e.radius, e.startAngle, e.endAngle, 48).map(transform), color);
          break;
        }
        case 'ELLIPSE': {
          pushPolyline(ellipseToPoints(entity as IEllipseEntity).map(transform), color);
          break;
        }
        case 'SPLINE': {
          const e = entity as ISplineEntity;
          const pts = (e.fitPoints?.length ? e.fitPoints : e.controlPoints) ?? [];
          pushPolyline(pts.map(transform), color);
          break;
        }
        case 'POINT': {
          const e = entity as IPointEntity;
          const p = transform(e.position);
          // Drawn as a near-zero-length dash rather than dropped — a lone DXF POINT usually marks a real
          // reference location (e.g. a drill center), and silently skipping it would make it look missing.
          segments.push({ points: [{ x: p.x - 1e-4, y: p.y }, { x: p.x + 1e-4, y: p.y }], color });
          break;
        }
        case 'INSERT': {
          const e = entity as IInsertEntity;
          const block = blocksByName[e.name];
          if (!block || onStack.has(e.name)) break;
          onStack.add(e.name);

          const cols = Math.max(1, e.columnCount || 1);
          const rows = Math.max(1, e.rowCount || 1);
          const colSpacing = e.columnSpacing || 0;
          const rowSpacing = e.rowSpacing || 0;
          const rotation = ((e.rotation || 0) * Math.PI) / 180;
          const cos = Math.cos(rotation);
          const sin = Math.sin(rotation);
          const xScale = e.xScale || 1;
          const yScale = e.yScale || 1;

          for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
              const baseX = e.position.x + col * colSpacing;
              const baseY = e.position.y + row * rowSpacing;
              const blockTransform = (p: Pt): Pt => {
                const sx = p.x * xScale;
                const sy = p.y * yScale;
                return transform({ x: baseX + sx * cos - sy * sin, y: baseY + sx * sin + sy * cos });
              };
              visitEntities(block.entities, blockTransform, depth + 1);
            }
          }
          onStack.delete(e.name);
          break;
        }
        default:
          break; // TEXT/MTEXT/DIMENSION/HATCH/SOLID/3DFACE/ATTDEF — geometry-only preview, see file header comment
      }
    }
  }

  visitEntities(dxf.entities ?? [], (p) => p, 0);
  return segments;
}

/** DXF's bulge-per-vertex convention: `vertices[i].bulge` describes the segment from vertex i to i+1. */
function polylineToPoints(vertices: { x: number; y: number; bulge?: number }[], closed: boolean): Pt[] {
  if (vertices.length === 0) return [];
  const points: Pt[] = [vertices[0]];
  const segmentCount = closed ? vertices.length : vertices.length - 1;
  for (let i = 0; i < segmentCount; i++) {
    const from = vertices[i];
    const to = vertices[(i + 1) % vertices.length];
    if (from.bulge) points.push(...bulgeToArcPoints(from, to, from.bulge, 16));
    else points.push(to);
  }
  return points;
}

/**
 * Bulge = tan(¼ included angle), signed by direction (AutoCAD's DXF
 * convention). Rather than derive the arc's center/radius directly from
 * the bulge formula (easy to get a sign wrong), this computes the known
 * arc midpoint from the exact sagitta relation (`sagitta = bulge·chord/2`)
 * and then fits a circle through the three points (start, mid, end) —
 * self-checking, since any sign error would produce a visibly wrong arc
 * immediately rather than a subtle one.
 */
function bulgeToArcPoints(p1: Pt, p2: Pt, bulge: number, segments: number): Pt[] {
  const chordLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  if (chordLen < 1e-9) return [p2];

  const sagitta = (bulge * chordLen) / 2;
  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const arcMid: Pt = { x: midX - (dy / chordLen) * sagitta, y: midY + (dx / chordLen) * sagitta };

  const center = circumcenter(p1, arcMid, p2);
  if (!center) return [p2]; // near-zero bulge — a straight segment is visually indistinguishable anyway

  const radius = Math.hypot(p1.x - center.x, p1.y - center.y);
  const startAngle = Math.atan2(p1.y - center.y, p1.x - center.x);
  const midAngle = Math.atan2(arcMid.y - center.y, arcMid.x - center.x);
  const endAngle = Math.atan2(p2.y - center.y, p2.x - center.x);

  const sweepToEndCCW = normalizeAngle(endAngle - startAngle);
  const sweepToMidCCW = normalizeAngle(midAngle - startAngle);
  const totalSweep = sweepToMidCCW <= sweepToEndCCW ? sweepToEndCCW : sweepToEndCCW - Math.PI * 2;

  const steps = Math.max(2, Math.ceil((Math.abs(totalSweep) / (Math.PI * 2)) * segments));
  const pts: Pt[] = [];
  for (let i = 1; i <= steps; i++) {
    const a = startAngle + (totalSweep * i) / steps;
    pts.push({ x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) });
  }
  pts[pts.length - 1] = p2; // pin the endpoint exactly — avoids a visible seam from angle round-trip drift
  return pts;
}

function circumcenter(p1: Pt, p2: Pt, p3: Pt): Pt | null {
  const d = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
  if (Math.abs(d) < 1e-9) return null;
  const s1 = p1.x * p1.x + p1.y * p1.y;
  const s2 = p2.x * p2.x + p2.y * p2.y;
  const s3 = p3.x * p3.x + p3.y * p3.y;
  return {
    x: (s1 * (p2.y - p3.y) + s2 * (p3.y - p1.y) + s3 * (p1.y - p2.y)) / d,
    y: (s1 * (p3.x - p2.x) + s2 * (p1.x - p3.x) + s3 * (p2.x - p1.x)) / d,
  };
}

function normalizeAngle(a: number): number {
  const r = a % (Math.PI * 2);
  return r < 0 ? r + Math.PI * 2 : r;
}

/** CIRCLE/ARC angles (already radians, converted by dxf-parser) sweep counterclockwise from start to end. */
function arcToPoints(center: Pt, radius: number, startAngle: number, endAngle: number, segments: number): Pt[] {
  let sweep = endAngle - startAngle;
  if (sweep <= 0) sweep += Math.PI * 2;
  const steps = Math.max(2, Math.ceil((sweep / (Math.PI * 2)) * segments));
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = startAngle + (sweep * i) / steps;
    pts.push({ x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) });
  }
  return pts;
}

/** ELLIPSE's `startAngle`/`endAngle` (DXF codes 41/42) are parametric angles along the *unrotated* ellipse, already in radians — distinct from ARC/CIRCLE's swept-angle-in-world convention. */
function ellipseToPoints(e: IEllipseEntity): Pt[] {
  const majorLen = Math.hypot(e.majorAxisEndPoint.x, e.majorAxisEndPoint.y);
  const rotation = Math.atan2(e.majorAxisEndPoint.y, e.majorAxisEndPoint.x);
  const minorLen = majorLen * (e.axisRatio ?? 1);
  const start = e.startAngle ?? 0;
  let sweep = (e.endAngle ?? Math.PI * 2) - start;
  if (sweep <= 0) sweep += Math.PI * 2;

  const steps = Math.max(2, Math.ceil((sweep / (Math.PI * 2)) * 64));
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = start + (sweep * i) / steps;
    const ex = majorLen * Math.cos(a);
    const ey = minorLen * Math.sin(a);
    pts.push({ x: e.center.x + ex * cos - ey * sin, y: e.center.y + ex * sin + ey * cos });
  }
  return pts;
}
