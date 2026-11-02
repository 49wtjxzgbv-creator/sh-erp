import type {
  IDxf,
  IEntity,
  IInsertEntity,
  ILineEntity,
  ILwpolylineEntity,
  IPolylineEntity,
  ICircleEntity,
  IArcEntity,
  IEllipseEntity,
  ISplineEntity,
  IPointEntity,
  ITextEntity,
  IMtextEntity,
  IDimensionEntity,
} from 'dxf-parser';

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

/** TEXT/MTEXT content — "тепер не видно розміри і текст" (2026-11-02), a separate array from `Segment` since it's drawn with `fillText`, not stroked. */
export interface TextLabel {
  /**
   * The point `anchorH`/`anchorV` are measured from — TEXT's own "second
   * alignment point" (group 11) when its justification isn't plain
   * left/baseline, per dxf-parser's own comment that group 11 is where
   * non-default-justified TEXT actually anchors ("тепер накладення тексту"
   * (2026-11-02): without this, every TEXT/MTEXT was drawn as if it were
   * left/top-anchored regardless of its real justification, so anything
   * centered or right/bottom-anchored landed shifted onto whatever was
   * actually next to its true position).
   */
  position: Pt;
  text: string;
  height: number;
  /** Radians, CCW-positive in DXF's own (unflipped) coordinate system — the viewer negates this when drawing, since its canvas Y axis is flipped relative to DXF's. */
  rotation: number;
  color: string | null;
  anchorH: 'left' | 'center' | 'right';
  anchorV: 'top' | 'middle' | 'bottom' | 'baseline';
}

export interface ExtractedGeometry {
  segments: Segment[];
  labels: TextLabel[];
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

/** `$DWGCODEPAGE` (group code 3) values actually seen from real exports → a `TextDecoder`-recognized encoding label. */
const DXF_CODEPAGE_TO_ENCODING: Record<string, string> = {
  ANSI_1250: 'windows-1250',
  ANSI_1251: 'windows-1251',
  ANSI_1252: 'windows-1252',
  ANSI_1253: 'windows-1253',
  ANSI_1254: 'windows-1254',
  ANSI_1255: 'windows-1255',
  ANSI_1256: 'windows-1256',
  ANSI_1257: 'windows-1257',
  ANSI_1258: 'windows-1258',
  ANSI_874: 'windows-874',
  ANSI_932: 'shift-jis',
  ANSI_936: 'gbk',
  ANSI_949: 'euc-kr',
  ANSI_950: 'big5',
};

/**
 * DXF ASCII files are plain bytes in whatever codepage AutoCAD declared via
 * the `$DWGCODEPAGE` header variable — NOT necessarily UTF-8. A
 * Ukrainian/Russian drawing exported from AutoCAD is typically `ANSI_1251`
 * (Windows-1251 Cyrillic); decoding those bytes as UTF-8 (the default for
 * `fetch(...).then(r => r.text())`) corrupts every non-ASCII character into
 * replacement glyphs — "якісь знаки питання" (2026-11-02), only visible
 * once this viewer started actually rendering TEXT/MTEXT content. Sniffs
 * the header for the real codepage before committing to a decoder; Latin-1
 * is used only for the sniff itself since it's a lossless 1:1 byte→codepoint
 * mapping, so the ASCII header keywords are found correctly no matter what
 * the body's actual encoding turns out to be.
 */
export function decodeDxfText(buffer: ArrayBuffer): string {
  const sniffed = new TextDecoder('latin1').decode(buffer);
  const match = /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*([A-Za-z0-9_]+)/.exec(sniffed);
  const encoding = match ? DXF_CODEPAGE_TO_ENCODING[match[1].toUpperCase()] : undefined;
  if (!encoding) return new TextDecoder('utf-8').decode(buffer);
  try {
    return new TextDecoder(encoding).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer); // unsupported label in this browser — fall back rather than throw
  }
}

/**
 * AutoCAD's own escape for embedding any Unicode character inside an
 * otherwise single-byte-codepage-safe DXF text string (`\U+XXXX`, exactly 4
 * hex digits — the same mechanism used for Cyrillic/CJK/any non-ASCII
 * annotation text regardless of `$DWGCODEPAGE`, and a common alternative to
 * raw codepage bytes). `dxf-parser` passes these straight through
 * unresolved, same as it does for codepage bytes. A surrogate pair (two
 * consecutive `\U+XXXX` escapes) resolves correctly with a plain
 * `fromCharCode`-per-escape replace, since JS strings are already UTF-16.
 */
function decodeUnicodeEscapes(text: string): string {
  return text.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

export function computeBoundingBox(segments: Segment[], labels: TextLabel[] = []): BBox {
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
  // Only the label's anchor point, not its real text extent — text is
  // small relative to real geometry in practice, and estimating actual
  // glyph-width bounds pre-render isn't worth it for a fit-to-view
  // approximation.
  for (const label of labels) {
    if (label.position.x < minX) minX = label.position.x;
    if (label.position.x > maxX) maxX = label.position.x;
    if (label.position.y < minY) minY = label.position.y;
    if (label.position.y > maxY) maxY = label.position.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Geometry-only preview: LINE/LWPOLYLINE/POLYLINE (bulge segments expanded
 * into arcs)/CIRCLE/ARC/ELLIPSE/SPLINE/POINT/INSERT (block references,
 * flattened with position/rotation/scale/array-copy) are drawn as segments;
 * TEXT/MTEXT/DIMENSION are drawn as labels (DIMENSION by flattening its
 * referenced anonymous block, same as INSERT — AutoCAD always expresses
 * that block's geometry directly in world coordinates, so no extra
 * offset/rotation/scale is needed beyond the transform already active at
 * that point in the entity tree). HATCH, SOLID and 3DFACE are still
 * silently skipped — out of scope for "what does this part look like."
 */
export function extractGeometry(dxf: IDxf): ExtractedGeometry {
  const segments: Segment[] = [];
  const labels: TextLabel[] = [];
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
        case 'TEXT': {
          const e = entity as ITextEntity;
          const halign = e.halign ?? 0;
          const valign = e.valign ?? 0;
          // Group 11 ("second alignment point") is only meaningful — and only where dxf-parser
          // actually populates it — once the entity isn't plain left/baseline justified; using
          // group 10 unconditionally here was the bug: a centered/right-justified TEXT rendered
          // as if it were left-justified at its FIRST alignment point, landing shifted onto
          // whatever real geometry/text sat where the text should have been centered/right-aligned.
          const anchor = (halign !== 0 || valign !== 0) && e.endPoint ? e.endPoint : e.startPoint;
          labels.push({
            position: transform(anchor),
            text: decodeUnicodeEscapes(e.text ?? ''),
            height: e.textHeight || DEFAULT_LABEL_HEIGHT,
            // Does not compose with an enclosing INSERT's own rotation (unlike point-based
            // geometry, which transforms correctly through `transform`) — a text entity nested
            // inside a rotated block will render at the right position but un-rotated. Accepted
            // as out of scope: dimension/label text inside rotated blocks is rare in real shop
            // files, and getting it right needs `transform` to expose its own rotation angle,
            // not just a point-mapping function.
            rotation: ((e.rotation || 0) * Math.PI) / 180,
            color,
            anchorH: textHalignToAnchorH(halign),
            anchorV: textValignToAnchorV(valign),
          });
          break;
        }
        case 'MTEXT': {
          const e = entity as IMtextEntity;
          const rotation =
            e.rotation != null ? (e.rotation * Math.PI) / 180 : e.directionVector ? Math.atan2(e.directionVector.y, e.directionVector.x) : 0;
          const [anchorH, anchorV] = mtextAttachmentPointToAnchor(e.attachmentPoint ?? 1);
          labels.push({
            position: transform(e.position),
            text: decodeUnicodeEscapes(cleanMtext(e.text ?? '')),
            height: e.height || DEFAULT_LABEL_HEIGHT,
            rotation,
            color,
            anchorH,
            anchorV,
          });
          break;
        }
        case 'DIMENSION': {
          const e = entity as IDimensionEntity;
          const block = e.block ? blocksByName[e.block] : undefined;
          if (block && !onStack.has(e.block)) {
            onStack.add(e.block);
            visitEntities(block.entities, transform, depth + 1);
            onStack.delete(e.block);
          } else {
            // Some exporters omit the anonymous block — fall back to just the measurement
            // text, so the dimension value is still visible even without the full
            // extension-line/arrow geometry.
            const pos = e.middleOfText ?? e.anchorPoint;
            const rawText =
              e.text && e.text !== '<>' ? e.text : e.actualMeasurement != null ? String(Math.round(e.actualMeasurement * 100) / 100) : null;
            if (pos && rawText) {
              labels.push({
                position: transform(pos),
                text: decodeUnicodeEscapes(rawText),
                height: DEFAULT_LABEL_HEIGHT,
                rotation: ((e.angle || 0) * Math.PI) / 180,
                color,
                anchorH: 'center',
                anchorV: 'middle',
              });
            }
          }
          break;
        }
        default:
          break; // HATCH/SOLID/3DFACE/ATTDEF — geometry-only preview, see file header comment
      }
    }
  }

  visitEntities(dxf.entities ?? [], (p) => p, 0);
  return { segments, labels };
}

/** Fallback text height (drawing units) when an entity doesn't carry one — a dimension's own synthesized fallback label, or a TEXT/MTEXT with `height`/`textHeight` of 0. */
const DEFAULT_LABEL_HEIGHT = 2.5;

/** DXF group 72 (TEXT horizontal justification) — "Aligned"/"Middle"/"Fit" (3/4/5) all involve scaling or dual-axis centering this viewer doesn't replicate; centering them horizontally is the closest single-point approximation. */
function textHalignToAnchorH(halign: number): TextLabel['anchorH'] {
  if (halign === 2) return 'right';
  if (halign >= 1) return 'center'; // 1 Center, 3 Aligned, 4 Middle, 5 Fit
  return 'left';
}

/** DXF group 73 (TEXT vertical justification): 0 Baseline, 1 Bottom, 2 Middle, 3 Top. */
function textValignToAnchorV(valign: number): TextLabel['anchorV'] {
  switch (valign) {
    case 1:
      return 'bottom';
    case 2:
      return 'middle';
    case 3:
      return 'top';
    default:
      return 'baseline';
  }
}

/** DXF group 71 (MTEXT attachment point), 1-9 laid out as a 3x3 grid, Top-Left to Bottom-Right; AutoCAD's own default when the code is absent is 1 (Top Left). */
function mtextAttachmentPointToAnchor(attachmentPoint: number): [TextLabel['anchorH'], TextLabel['anchorV']] {
  const anchorH: TextLabel['anchorH'] = [1, 4, 7].includes(attachmentPoint) ? 'left' : [3, 6, 9].includes(attachmentPoint) ? 'right' : 'center';
  const anchorV: TextLabel['anchorV'] = attachmentPoint <= 3 ? 'top' : attachmentPoint <= 6 ? 'middle' : 'bottom';
  return [anchorH, anchorV];
}

/**
 * Strips MTEXT's inline formatting codes down to the plain drawn text —
 * this viewer renders filled text as-is, it doesn't apply the formatting
 * itself (`\P` paragraph breaks, `{...}` grouping, and property codes like
 * `\W0.7;`/`\H2.5;`/`\C1;`/`\L`/`\l`/`\O`/`\o`/`\K`/`\k`).
 */
function cleanMtext(raw: string): string {
  return raw
    .replace(/\\P/g, '\n')
    .replace(/\\~/g, ' ')
    .replace(/\\[LlOoKk]/g, '')
    .replace(/\\[A-Za-z][^;\\{}]*;/g, '')
    .replace(/[{}]/g, '')
    .replace(/\\\\/g, '\\');
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
