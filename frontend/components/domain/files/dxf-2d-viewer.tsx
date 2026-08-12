'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Ruler } from 'lucide-react';
import type { Segment, BBox, Pt } from './dxf-geometry';
import type { DxfParseRequest, DxfParseResponse } from './dxf-parser.worker';

/**
 * Renders a DXF (2D CAD drawing exchange) file in-browser on a plain
 * `<canvas>` — no WebGL/three.js needed, unlike `Step3DViewer`: DXF is
 * inherently flat. Parsing (`dxf-parser`) and geometry extraction run in
 * `dxf-parser.worker.ts`, not on the main thread — see that worker's
 * header comment for why (a real multi-hundred-entity shop-floor file
 * froze the tab when this ran inline). This component only fetches the
 * raw text, hands it to the worker, and draws whatever comes back.
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

interface View {
  scale: number;
  offsetX: number;
  offsetY: number;
}

const DEFAULT_STROKE = '#1f2937';
const BACKGROUND = '#f3f4f6';
const MEASURE_COLOR = '#dc2626';

interface Measurement {
  start: Pt | null;
  end: Pt | null;
}

/**
 * A pathological file (huge entity count, deeply nested blocks) could in
 * principle take a very long time to extract — this exists only to turn
 * that into an eventual error instead of a silent unbounded wait, same
 * role as `Step3DViewer`'s `PARSE_TIMEOUT_MS`. DXF text parsing is far
 * cheaper than STEP's WASM tessellation, so a much shorter bound suffices.
 */
const PARSE_TIMEOUT_MS = 60 * 1000;

export function Dxf2DViewer({ url }: Dxf2DViewerProps) {
  const t = useTranslations('files');
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<ViewerState>('loading');
  const [measureMode, setMeasureMode] = useState(false);
  const [measureDistance, setMeasureDistance] = useState<number | null>(null);
  const segmentsRef = useRef<Segment[]>([]);
  const bboxRef = useRef<BBox | null>(null);
  const unitLabelRef = useRef<string | null>(null);
  const viewRef = useRef<View>({ scale: 1, offsetX: 0, offsetY: 0 });
  const measureModeRef = useRef(false);
  const measureRef = useRef<Measurement>({ start: null, end: null });
  const hoverRef = useRef<Pt | null>(null);
  const drawRef = useRef<() => void>(() => {});

  useEffect(() => {
    measureModeRef.current = measureMode;
    if (!measureMode) {
      measureRef.current = { start: null, end: null };
      hoverRef.current = null;
      setMeasureDistance(null);
    }
    drawRef.current();
  }, [measureMode]);

  useEffect(() => {
    let cancelled = false;
    let worker: Worker | undefined;

    async function load() {
      setState('loading');
      try {
        const text = await fetch(url).then((r) => {
          if (!r.ok) throw new Error(`Failed to download drawing (${r.status})`);
          return r.text();
        });
        if (cancelled) return;

        const { segments, bbox, unitLabel } = await parseInWorker(text, (w) => (worker = w));
        if (cancelled) return;

        segmentsRef.current = segments;
        bboxRef.current = bbox;
        unitLabelRef.current = unitLabel;
        setState('ready');
      } catch (err) {
        console.error('[Dxf2DViewer] failed to load/render drawing:', err);
        if (!cancelled) setState('error');
      }
    }

    load();
    return () => {
      cancelled = true;
      worker?.terminate();
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

      drawMeasurement();
    }

    function toScreen(p: Pt): Pt {
      const { scale, offsetX, offsetY } = viewRef.current;
      return { x: offsetX + p.x * scale, y: offsetY - p.y * scale };
    }

    /** Draws the ruler tool's own overlay: a marker at each placed point, a line between them (dashed while still following the pointer toward a second point), and a distance readout pinned above the line's midpoint. */
    function drawMeasurement() {
      const { start, end } = measureRef.current;
      if (!start) return;
      const to = end ?? hoverRef.current;
      if (!to) {
        drawMarker(start);
        return;
      }

      const a = toScreen(start);
      const b = toScreen(to);
      ctx!.save();
      ctx!.strokeStyle = MEASURE_COLOR;
      ctx!.lineWidth = 1.5;
      if (!end) ctx!.setLineDash([5, 4]);
      ctx!.beginPath();
      ctx!.moveTo(a.x, a.y);
      ctx!.lineTo(b.x, b.y);
      ctx!.stroke();
      ctx!.restore();

      drawMarker(start);
      drawMarker(to);

      const distance = Math.hypot(to.x - start.x, to.y - start.y);
      const label = unitLabelRef.current ? `${distance.toFixed(2)} ${unitLabelRef.current}` : distance.toFixed(2);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;

      ctx!.font = '12px sans-serif';
      const textWidth = ctx!.measureText(label).width;
      ctx!.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx!.fillRect(midX - textWidth / 2 - 4, midY - 22, textWidth + 8, 16);
      ctx!.fillStyle = MEASURE_COLOR;
      ctx!.textAlign = 'center';
      ctx!.fillText(label, midX, midY - 10);
    }

    function drawMarker(p: Pt) {
      const s = toScreen(p);
      ctx!.beginPath();
      ctx!.arc(s.x, s.y, 3, 0, Math.PI * 2);
      ctx!.fillStyle = MEASURE_COLOR;
      ctx!.fill();
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

    function screenToWorld(sx: number, sy: number): Pt {
      const { scale, offsetX, offsetY } = viewRef.current;
      return { x: (sx - offsetX) / scale, y: -(sy - offsetY) / scale };
    }

    function placeMeasurePoint(sx: number, sy: number) {
      const world = screenToWorld(sx, sy);
      const { start, end } = measureRef.current;
      if (!start || end) {
        measureRef.current = { start: world, end: null };
        setMeasureDistance(null);
      } else {
        measureRef.current = { start, end: world };
        setMeasureDistance(Math.hypot(world.x - start.x, world.y - start.y));
      }
      draw();
    }

    drawRef.current = draw;
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

      if (measureModeRef.current && activePointers.size === 1) {
        const rect = canvas!.getBoundingClientRect();
        placeMeasurePoint(e.clientX - rect.left, e.clientY - rect.top);
        return; // single-pointer taps place measurement points instead of panning
      }

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
      if (measureModeRef.current && measureRef.current.start && !measureRef.current.end) {
        const rect = canvas!.getBoundingClientRect();
        hoverRef.current = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        draw();
      }

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
      if (measureModeRef.current) return; // avoid recentering mid-measurement on two quick placement taps
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
      {state === 'ready' && (
        <div className="absolute right-3 top-3 flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={() => setMeasureMode((v) => !v)}
            aria-pressed={measureMode}
            aria-label={t('measure')}
            title={t('measure')}
            className={`flex h-9 w-9 items-center justify-center rounded-md border shadow-sm ${
              measureMode ? 'border-destructive bg-destructive text-destructive-foreground' : 'border-border bg-background text-foreground'
            }`}
          >
            <Ruler className="h-4 w-4" />
          </button>
          {measureMode && (
            <p className="rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground shadow-sm">
              {measureDistance != null
                ? `${measureDistance.toFixed(2)}${unitLabelRef.current ? ` ${unitLabelRef.current}` : ''}`
                : t('measureHint')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Runs the actual parse+extraction in `dxf-parser.worker.ts`. `onWorker`
 * hands the created `Worker` back to the caller immediately so it can be
 * terminated on unmount even while a parse is still in flight — same
 * pattern as `Step3DViewer`'s `parseInWorker`.
 */
function parseInWorker(
  text: string,
  onWorker: (worker: Worker) => void,
): Promise<{ segments: Segment[]; bbox: BBox; unitLabel: string | null }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./dxf-parser.worker.ts', import.meta.url));
    onWorker(worker);

    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('Parsing timed out.'));
    }, PARSE_TIMEOUT_MS);

    worker.onmessage = (event: MessageEvent<DxfParseResponse>) => {
      clearTimeout(timeout);
      worker.terminate();
      if (event.data.ok) resolve({ segments: event.data.segments, bbox: event.data.bbox, unitLabel: event.data.unitLabel });
      else reject(new Error(event.data.error));
    };
    worker.onerror = (event) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error(event.message || 'Worker error.'));
    };

    const request: DxfParseRequest = { text };
    worker.postMessage(request);
  });
}
