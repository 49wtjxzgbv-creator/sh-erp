'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import DxfParser from 'dxf-parser';
import type { IDxf, IEntity, IInsertEntity, ILineEntity, ILwpolylineEntity, IPolylineEntity, ICircleEntity, IArcEntity, IEllipseEntity, ISplineEntity, IPointEntity } from 'dxf-parser';

/**
 * Renders a DXF (2D CAD drawing exchange) file in-browser on a plain
 * `<canvas>` — no WebGL/three.js needed, unlike `Step3DViewer`: DXF is
 * inherently flat, and `dxf-parser` (pure JS, no WASM) is fast enough on
 * real shop-floor drawings to parse synchronously on the main thread
 * without a worker.
 *
 * Geometry-only preview: LINE/LWPOLYLINE/POLYLINE (bulge segments expanded
 * into arcs)/CIRCLE/ARC/ELLIPSE/SPLINE/POINT/INSERT (block references,
 * flattened with position/rotation/scale/array-copy) are drawn; TEXT,
 * MTEXT, DIMENSION, HATCH, SOLID and 3DFACE are silently skipped — this is
 * "what does this part look like", not a full CAD viewer, and skipping
 * text avoids pulling in a font-rendering dependency for it.
 *
 * Loaded lazily via `next/dynamic` from `entity-documents-field.tsx`
 * (`ssr: false`) so `dxf-parser` never enters any page's main bundle —
 * only fetched the moment someone actually opens a .dxf file.
 */
export interface Dxf2DViewerProps {
  /** Presigned download URL for the raw .dxf file. */
  url: string;
}

type ViewerState = 'loading' | 'ready' | 'error';

interface Pt {
  x: number;
  y: number;
}

interface Segment {
  points: Pt[];
  color: string | null;
}

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface View {
  scale: number;
  offsetX: number;
  offsetY: number;
}

const DEFAULT_STROKE = '#1f2937';
const BACKGROUND = '#f3f4f6';

export function Dxf2DViewer({ url }: Dxf2DViewerProps) {
  const t = useTranslations('files');
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<ViewerState>('loading');
  const segmentsRef = useRef<Segment[]>([]);
  const bboxRef = useRef<BBox | null>(null);
  const viewRef = useRef<View>({ scale: 1, offsetX: 0, offsetY: 0 });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState('loading');
      try {
        const text = await fetch(url).then((r) => {
          if (!r.ok) throw new Error(`Failed to download drawing (${r.status})`);
          return r.text();
        });
        const dxf = new DxfParser().parseSync(text);
        if (!dxf) throw new Error('Could not parse DXF file.');

        const segments = extractSegments(dxf);
        if (segments.length === 0) throw new Error('No supported geometry found in file.');
        if (cancelled) return;

        segmentsRef.current = segments;
        bboxRef.current = computeBoundingBox(segments);
        setState('ready');
      } catch (err) {
        console.error('[Dxf2DViewer] failed to load/render drawing:', err);
        if (!cancelled) setState('error');
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    if (state !== 'ready') return;
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!container || !canvas || !ctx) return;

    function draw() {
      const w = container!.clientWidth || 1;
      const h = container!.clientHeight || 1;
      const { scale, offsetX, offsetY } = viewRef.current;

      ctx!.clearRect(0, 0, w, h);
      ctx!.fillStyle = BACKGROUND;
      ctx!.fillRect(0, 0, w, h);
      ctx!.lineWidth = 1;

      for (const seg of segmentsRef.current) {
        if (seg.points.length < 2) continue;
        ctx!.strokeStyle = seg.color ?? DEFAULT_STROKE;
        ctx!.beginPath();
        const [first, ...rest] = seg.points;
        ctx!.moveTo(offsetX + first.x * scale, offsetY - first.y * scale);
        for (const p of rest) ctx!.lineTo(offsetX + p.x * scale, offsetY - p.y * scale);
        ctx!.stroke();
      }
    }

    function fitToView() {
      const bbox = bboxRef.current;
      if (!bbox) return;
      const w = container!.clientWidth || 1;
      const h = container!.clientHeight || 1;
      const bw = Math.max(bbox.maxX - bbox.minX, 1e-6);
      const bh = Math.max(bbox.maxY - bbox.minY, 1e-6);
      const pad = 24;
      const scale = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
      const cx = (bbox.minX + bbox.maxX) / 2;
      const cy = (bbox.minY + bbox.maxY) / 2;
      viewRef.current = { scale, offsetX: w / 2 - cx * scale, offsetY: h / 2 + cy * scale };
    }

    function resizeCanvas() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = container!.clientWidth || 1;
      const h = container!.clientHeight || 1;
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    }

    function zoomAt(sx: number, sy: number, newScale: number) {
      const { scale, offsetX, offsetY } = viewRef.current;
      const clamped = Math.min(Math.max(newScale, 1e-8), 1e8);
      const wx = (sx - offsetX) / scale;
      const wy = -(sy - offsetY) / scale;
      viewRef.current = { scale: clamped, offsetX: sx - wx * clamped, offsetY: sy + wy * clamped };
      draw();
    }

    fitToView();
    resizeCanvas();

    const resizeObserver = new ResizeObserver(() => {
      fitToView();
      resizeCanvas();
    });
    resizeObserver.observe(container);

    // Pointer Events unify mouse and touch: one active pointer pans, two
    // pointers pinch-zoom around their midpoint — the 2D-canvas equivalent
    // of `OrbitControls`' built-in touch handling in `Step3DViewer`.
    const activePointers = new Map<number, { x: number; y: number }>();
    let isPanning = false;
    let lastX = 0;
    let lastY = 0;
    let pinchStartDist = 0;
    let pinchStartScale = 1;

    function onPointerDown(e: PointerEvent) {
      canvas!.setPointerCapture(e.pointerId);
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.size === 1) {
        isPanning = true;
        lastX = e.clientX;
        lastY = e.clientY;
      } else if (activePointers.size === 2) {
        isPanning = false;
        const [a, b] = Array.from(activePointers.values());
        pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        pinchStartScale = viewRef.current.scale;
      }
    }

    function onPointerMove(e: PointerEvent) {
      if (!activePointers.has(e.pointerId)) return;
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.size === 2) {
        const [a, b] = Array.from(activePointers.values());
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const rect = canvas!.getBoundingClientRect();
        zoomAt((a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top, pinchStartScale * (dist / pinchStartDist));
      } else if (isPanning) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        viewRef.current = { ...viewRef.current, offsetX: viewRef.current.offsetX + dx, offsetY: viewRef.current.offsetY + dy };
        draw();
      }
    }

    function onPointerUp(e: PointerEvent) {
      activePointers.delete(e.pointerId);
      if (activePointers.size === 1) {
        const [p] = Array.from(activePointers.values());
        lastX = p.x;
        lastY = p.y;
        isPanning = true;
      } else {
        isPanning = activePointers.size > 0;
      }
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = canvas!.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, viewRef.current.scale * Math.exp(-e.deltaY * 0.0015));
    }

    function onDoubleClick() {
      fitToView();
      draw();
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDoubleClick);

    return () => {
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDoubleClick);
    };
  }, [state]);

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <canvas ref={canvasRef} className="h-full w-full touch-none" />
      {state === 'loading' && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">{t('loadingDrawing')}</p>
      )}
      {state === 'error' && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-destructive">{t('drawingLoadError')}</p>
      )}
    </div>
  );
}

function computeBoundingBox(segments: Segment[]): BBox {
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

function extractSegments(dxf: IDxf): Segment[] {
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
