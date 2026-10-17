'use client';

import { useEffect, useRef, useState } from 'react';
import type { PageViewport } from 'pdfjs-dist';
import { cn } from '@/lib/utils';
import { newId, type Annotation, type AnnotationTool, type ExistingTextRun, type PdfSource, type WorkingPage } from './types';

interface PdfPageCanvasProps {
  page: WorkingPage;
  source: PdfSource;
  zoom: number;
  tool: AnnotationTool;
  annotations: Annotation[];
  selectedAnnotationId: string | null;
  onAddAnnotation: (annotation: Annotation) => void;
  onUpdateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  onSelectAnnotation: (id: string | null) => void;
  onDeleteAnnotation: (id: string) => void;
}

const TEXT_LINE_HEIGHT = 1.2;
/** PDF-point drag distance below which an 'edit'-tool gesture on an existing text run counts as a plain click (open it for retyping) rather than a drag (move it elsewhere). */
const DRAG_THRESHOLD = 3;

/** Bounding box of a PDF-space rectangle, projected into the CURRENT viewport's screen pixels. A rect's corners stay axis-aligned after any 90°-multiple rotation, so min/max over the 4 projected corners is always correct — this is simpler than tracking "which corner is top-left" through a rotation. */
function rectToScreen(rect: { x: number; y: number; width: number; height: number }, viewport: PageViewport) {
  const corners = [
    viewport.convertToViewportPoint(rect.x, rect.y),
    viewport.convertToViewportPoint(rect.x + rect.width, rect.y),
    viewport.convertToViewportPoint(rect.x, rect.y + rect.height),
    viewport.convertToViewportPoint(rect.x + rect.width, rect.y + rect.height),
  ];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

/** A run's natural "redact" box — padded slightly beyond its glyph metrics so a cover reliably hides descenders/antialiasing, not just the exact advance box. */
function runRedactBox(run: ExistingTextRun) {
  return { x: run.x - 0.5, y: run.y - run.height * 0.25, width: run.width + 1, height: run.height * 1.15 };
}

interface PendingTextEditor {
  x: number;
  y: number;
  width: number;
  fontSize: number;
  text: string;
  /** Set only when this editor is replacing an existing run (the 'edit' tool) — committed alongside the new 'text' annotation so the original glyphs are hidden. Absent for a brand-new text block (the 'text' tool) or when re-editing an already-committed text annotation. */
  redactOriginal?: { x: number; y: number; width: number; height: number };
  /** The run's original string, to skip committing anything at all if the user opened an existing run and closed it unchanged. */
  originalText?: string;
  /** Set when re-editing an already-committed 'text' annotation (double-click) — commits via onUpdateAnnotation instead of creating a new one. */
  editingAnnotationId?: string;
}

/**
 * Renders one working page onto a <canvas> via pdfjs-dist, with an
 * interactive overlay for the active annotation tool. All annotation
 * coordinates are stored in the page's intrinsic PDF-point space (origin
 * bottom-left, Y up, unaffected by zoom or rotation) via
 * `viewport.convertToPdfPoint`/`convertToViewportPoint` — the same space
 * pdf-lib's draw* calls use when the final document is exported, so an
 * annotation drawn at zoom 100%, rotation 0 lands in the exact same spot
 * after the user zooms to 200% or rotates the page.
 *
 * "Редагувати" (edit existing text/images) deliberately does NOT rewrite the
 * PDF's own content stream — parsing and surgically removing an arbitrary
 * glyph run or image XObject from a real-world PDF (compressed streams,
 * subset fonts, arbitrary operators) is not something this client-side
 * pdf-lib/pdfjs stack can do reliably, and isn't something even most
 * commercial PDF SDKs attempt casually. Instead: an existing text run is
 * found via pdfjs's own `getTextContent()` (so hit-testing is exact, not a
 * guessed rectangle), the matched region is covered with an opaque 'redact'
 * rectangle, and a replacement 'text' annotation (new content or just moved)
 * or captured-pixel 'image' annotation is drawn on top — see types.ts's own
 * comments on those two Annotation variants for the full rationale.
 */
export function PdfPageCanvas({
  page,
  source,
  zoom,
  tool,
  annotations,
  selectedAnnotationId,
  onAddAnnotation,
  onUpdateAnnotation,
  onSelectAnnotation,
  onDeleteAnnotation,
}: PdfPageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<PageViewport | null>(null);
  const textRunsRef = useRef<ExistingTextRun[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const [draftRect, setDraftRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [draftPath, setDraftPath] = useState<{ x: number; y: number }[] | null>(null);
  const [pendingNote, setPendingNote] = useState<{ x: number; y: number; text: string } | null>(null);
  const [pendingText, setPendingText] = useState<PendingTextEditor | null>(null);
  const [hoverRun, setHoverRun] = useState<ExistingTextRun | null>(null);
  const [dragPreview, setDragPreview] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const dragging = useRef(false);
  const shapeDragOrigin = useRef<{ x: number; y: number } | null>(null);
  const editRunDrag = useRef<{ run: ExistingTextRun; startX: number; startY: number; curX: number; curY: number; moved: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let renderTask: ReturnType<import('pdfjs-dist').PDFPageProxy['render']> | null = null;

    (async () => {
      const pdfPage = await source.pdfjsDoc.getPage(page.sourceIndex + 1);
      if (cancelled) return;
      const rotation = (pdfPage.rotate + page.rotation + 360) % 360;
      const viewport = pdfPage.getViewport({ scale: zoom, rotation });
      viewportRef.current = viewport;
      setSize({ width: viewport.width, height: viewport.height });

      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      renderTask = pdfPage.render({ canvas, viewport });
      try {
        await renderTask.promise;
      } catch {
        // Cancelled render (page swapped out before finishing) — nothing to recover, the next effect run supersedes it.
      }

      try {
        const textContent = await pdfPage.getTextContent();
        const runs: ExistingTextRun[] = [];
        for (const item of textContent.items) {
          if (!('str' in item) || !('transform' in item)) continue; // TextMarkedContent, not an actual glyph run
          if (!item.str || !item.str.trim()) continue;
          const t = item.transform;
          const fontSize = Math.abs(t[3]) || Math.abs(t[2]) || item.height || 10;
          runs.push({ str: item.str, x: t[4], y: t[5], width: item.width, height: item.height || fontSize, fontSize });
        }
        if (!cancelled) textRunsRef.current = runs;
      } catch {
        // Text layer is a nice-to-have for the 'edit' tool — a page this fails on just can't have its existing text edited, everything else still works.
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [source, page.sourceIndex, page.rotation, zoom]);

  function screenToPdf(clientX: number, clientY: number): [number, number] {
    const rect = overlayRef.current?.getBoundingClientRect();
    const viewport = viewportRef.current;
    if (!rect || !viewport) return [0, 0];
    return viewport.convertToPdfPoint(clientX - rect.left, clientY - rect.top) as [number, number];
  }

  function findTextRunAt(x: number, y: number): ExistingTextRun | null {
    const runs = textRunsRef.current;
    for (let i = runs.length - 1; i >= 0; i--) {
      const r = runs[i];
      if (x >= r.x && x <= r.x + r.width && y >= r.y - r.height * 0.3 && y <= r.y + r.height * 1.1) return r;
    }
    return null;
  }

  function openTextEditor(editor: PendingTextEditor) {
    setPendingText(editor);
  }

  function commitPendingText() {
    const pt = pendingText;
    setPendingText(null);
    if (!pt) return;
    const text = pt.text.trim();

    if (pt.editingAnnotationId) {
      if (text) {
        onUpdateAnnotation(pt.editingAnnotationId, { text } as Partial<Annotation>);
      } else {
        onDeleteAnnotation(pt.editingAnnotationId);
      }
      return;
    }

    if (pt.redactOriginal && text === (pt.originalText ?? '').trim()) return; // opened an existing run, closed it unchanged — nothing to do

    if (!text) return;
    if (pt.redactOriginal) {
      onAddAnnotation({ id: newId(), pageKey: page.key, type: 'redact', ...pt.redactOriginal });
    }
    onAddAnnotation({ id: newId(), pageKey: page.key, type: 'text', x: pt.x, y: pt.y, width: pt.width, fontSize: pt.fontSize, text });
  }

  function startDragShape(e: React.PointerEvent, ann: Annotation) {
    if (tool !== 'select' || !('x' in ann) || !('y' in ann)) return;
    e.stopPropagation();
    onSelectAnnotation(ann.id);
    const [x, y] = screenToPdf(e.clientX, e.clientY);
    shapeDragOrigin.current = { x, y };
    setDragPreview({ id: ann.id, dx: 0, dy: 0 });
    try {
      overlayRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // Not fatal — see handlePointerDown's own comment on this.
    }
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (tool === 'select') {
      if (e.target === overlayRef.current) onSelectAnnotation(null);
      return;
    }
    const [x, y] = screenToPdf(e.clientX, e.clientY);
    try {
      overlayRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // Capture is a nice-to-have (keeps drag tracking working if the cursor leaves the overlay mid-gesture) — it can
      // throw NotFoundError for a pointer the browser doesn't consider "active" (observed with a fast click-no-move
      // gesture), which must never abort annotation creation below.
    }

    if (tool === 'highlight') {
      dragging.current = true;
      setDraftRect({ x0: x, y0: y, x1: x, y1: y });
    } else if (tool === 'draw') {
      dragging.current = true;
      setDraftPath([{ x, y }]);
    } else if (tool === 'note') {
      setPendingNote({ x, y, text: '' });
    } else if (tool === 'text') {
      openTextEditor({ x, y, width: 180, fontSize: 14, text: '' });
    } else if (tool === 'edit') {
      const run = findTextRunAt(x, y);
      if (run) {
        dragging.current = true;
        editRunDrag.current = { run, startX: x, startY: y, curX: x, curY: y, moved: false };
      } else {
        dragging.current = true;
        setDraftRect({ x0: x, y0: y, x1: x, y1: y });
      }
    }
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (dragPreview && shapeDragOrigin.current) {
      const [x, y] = screenToPdf(e.clientX, e.clientY);
      setDragPreview({ ...dragPreview, dx: x - shapeDragOrigin.current.x, dy: y - shapeDragOrigin.current.y });
      return;
    }

    if (tool === 'edit' && !dragging.current) {
      const [x, y] = screenToPdf(e.clientX, e.clientY);
      setHoverRun(findTextRunAt(x, y));
    }

    if (!dragging.current) return;
    const [x, y] = screenToPdf(e.clientX, e.clientY);
    if (editRunDrag.current) {
      const d = editRunDrag.current;
      d.curX = x;
      d.curY = y;
      if (!d.moved && Math.hypot(x - d.startX, y - d.startY) > DRAG_THRESHOLD) d.moved = true;
      if (d.moved) setDraftRect(null);
      return;
    }
    if ((tool === 'highlight' || tool === 'edit') && draftRect) {
      setDraftRect({ ...draftRect, x1: x, y1: y });
    } else if (tool === 'draw' && draftPath) {
      setDraftPath([...draftPath, { x, y }]);
    }
  }

  function captureRegionAsImage(x: number, y: number, width: number, height: number) {
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    if (!canvas || !viewport || width < 4 || height < 4) return;
    const r = rectToScreen({ x, y, width, height }, viewport);
    if (r.width < 4 || r.height < 4) return;
    const temp = document.createElement('canvas');
    temp.width = Math.round(r.width);
    temp.height = Math.round(r.height);
    const ctx = temp.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(canvas, r.left, r.top, r.width, r.height, 0, 0, temp.width, temp.height);
    const dataUrl = temp.toDataURL('image/png');
    onAddAnnotation({ id: newId(), pageKey: page.key, type: 'redact', x, y, width, height });
    onAddAnnotation({ id: newId(), pageKey: page.key, type: 'image', x, y, width, height, dataUrl });
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (dragPreview) {
      const ann = annotations.find((a) => a.id === dragPreview.id);
      if (ann && 'x' in ann && 'y' in ann) {
        onUpdateAnnotation(dragPreview.id, { x: ann.x + dragPreview.dx, y: ann.y + dragPreview.dy } as Partial<Annotation>);
      }
      setDragPreview(null);
      shapeDragOrigin.current = null;
      try {
        overlayRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        // See handlePointerDown's own comment.
      }
      return;
    }

    dragging.current = false;
    try {
      overlayRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // Nothing to release if capture was never acquired — see handlePointerDown's own comment.
    }

    if (editRunDrag.current) {
      const d = editRunDrag.current;
      editRunDrag.current = null;
      if (d.moved) {
        const dx = d.curX - d.startX;
        const dy = d.curY - d.startY;
        onAddAnnotation({ id: newId(), pageKey: page.key, type: 'redact', ...runRedactBox(d.run) });
        onAddAnnotation({
          id: newId(),
          pageKey: page.key,
          type: 'text',
          x: d.run.x + dx,
          y: d.run.y + dy,
          width: d.run.width,
          fontSize: d.run.fontSize,
          text: d.run.str,
        });
      } else {
        openTextEditor({
          x: d.run.x,
          y: d.run.y,
          width: Math.max(d.run.width, 120),
          fontSize: d.run.fontSize,
          text: d.run.str,
          redactOriginal: runRedactBox(d.run),
          originalText: d.run.str,
        });
      }
      return;
    }

    if (tool === 'highlight' && draftRect) {
      const x = Math.min(draftRect.x0, draftRect.x1);
      const y = Math.min(draftRect.y0, draftRect.y1);
      const width = Math.abs(draftRect.x1 - draftRect.x0);
      const height = Math.abs(draftRect.y1 - draftRect.y0);
      setDraftRect(null);
      if (width > 2 && height > 2) {
        onAddAnnotation({ id: newId(), pageKey: page.key, type: 'highlight', x, y, width, height });
      }
    } else if (tool === 'edit' && draftRect) {
      const x = Math.min(draftRect.x0, draftRect.x1);
      const y = Math.min(draftRect.y0, draftRect.y1);
      const width = Math.abs(draftRect.x1 - draftRect.x0);
      const height = Math.abs(draftRect.y1 - draftRect.y0);
      setDraftRect(null);
      captureRegionAsImage(x, y, width, height);
    } else if (tool === 'draw' && draftPath) {
      const path = draftPath;
      setDraftPath(null);
      if (path.length > 1) {
        onAddAnnotation({ id: newId(), pageKey: page.key, type: 'draw', points: path });
      }
    }
  }

  const viewport = viewportRef.current;
  const pageAnnotations = annotations.filter((a) => a.pageKey === page.key);

  return (
    <div className="relative inline-block border border-border bg-white shadow-sm" style={{ width: size.width, height: size.height }}>
      <canvas ref={canvasRef} className="block" />
      <div
        ref={overlayRef}
        className={cn(
          'absolute inset-0',
          tool === 'select' && 'cursor-default',
          (tool === 'highlight' || tool === 'draw') && 'cursor-crosshair',
          tool === 'note' && 'cursor-copy',
          tool === 'text' && 'cursor-text',
          tool === 'edit' && (hoverRun ? 'cursor-text' : 'cursor-crosshair'),
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {viewport && (
          <svg className="pointer-events-none absolute inset-0 overflow-visible" width={size.width} height={size.height}>
            {tool === 'edit' && hoverRun && !editRunDrag.current && (() => {
              const r = rectToScreen(runRedactBox(hoverRun), viewport);
              return <rect x={r.left} y={r.top} width={r.width} height={r.height} fill="rgba(37, 99, 235, 0.12)" stroke="#2563eb" strokeDasharray="3 2" />;
            })()}

            {pageAnnotations.map((ann) => {
              const selected = ann.id === selectedAnnotationId;
              const effective = dragPreview && dragPreview.id === ann.id && 'x' in ann && 'y' in ann ? { ...ann, x: ann.x + dragPreview.dx, y: ann.y + dragPreview.dy } : ann;

              if (effective.type === 'highlight') {
                const r = rectToScreen(effective, viewport);
                return (
                  <rect
                    key={ann.id}
                    x={r.left}
                    y={r.top}
                    width={r.width}
                    height={r.height}
                    fill="rgba(250, 204, 21, 0.4)"
                    stroke={selected ? '#2563eb' : 'transparent'}
                    strokeWidth={2}
                    className="pointer-events-auto cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (tool === 'select') onSelectAnnotation(ann.id);
                    }}
                  />
                );
              }

              if (effective.type === 'draw') {
                const pts = effective.points.map((p) => viewport.convertToViewportPoint(p.x, p.y));
                return (
                  <polyline
                    key={ann.id}
                    points={pts.map(([x, y]) => `${x},${y}`).join(' ')}
                    fill="none"
                    stroke={selected ? '#2563eb' : '#ef4444'}
                    strokeWidth={selected ? 4 : 2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="pointer-events-auto cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (tool === 'select') onSelectAnnotation(ann.id);
                    }}
                  />
                );
              }

              if (effective.type === 'redact') {
                const r = rectToScreen(effective, viewport);
                return <rect key={ann.id} x={r.left} y={r.top} width={r.width} height={r.height} fill="white" />;
              }

              if (effective.type === 'image') {
                const r = rectToScreen(effective, viewport);
                return (
                  <g key={ann.id} className="pointer-events-auto cursor-move" onPointerDown={(e) => startDragShape(e, ann)}>
                    <image href={effective.dataUrl} x={r.left} y={r.top} width={r.width} height={r.height} preserveAspectRatio="none" />
                    {selected && <rect x={r.left} y={r.top} width={r.width} height={r.height} fill="none" stroke="#2563eb" strokeWidth={2} strokeDasharray="4 2" />}
                  </g>
                );
              }

              if (effective.type === 'text') {
                const lines = effective.text.split('\n');
                const lineHeight = effective.fontSize * TEXT_LINE_HEIGHT;
                const bbox = rectToScreen({ x: effective.x, y: effective.y - lineHeight * (lines.length - 1) - effective.fontSize * 0.3, width: effective.width, height: lineHeight * lines.length }, viewport);
                return (
                  <g
                    key={ann.id}
                    className="pointer-events-auto cursor-move"
                    onPointerDown={(e) => startDragShape(e, ann)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      openTextEditor({ x: effective.x, y: effective.y, width: effective.width, fontSize: effective.fontSize, text: effective.text, editingAnnotationId: ann.id });
                    }}
                  >
                    {selected && <rect x={bbox.left} y={bbox.top} width={bbox.width} height={bbox.height} fill="none" stroke="#2563eb" strokeDasharray="4 2" />}
                    {lines.map((line, i) => {
                      const [lx, ly] = viewport.convertToViewportPoint(effective.x, effective.y - i * lineHeight);
                      return (
                        <text key={i} x={lx} y={ly} fontSize={effective.fontSize * zoom} fontFamily="Helvetica, Arial, sans-serif" fill={selected ? '#2563eb' : '#111827'}>
                          {line}
                        </text>
                      );
                    })}
                  </g>
                );
              }

              // 'note'
              const [vx, vy] = viewport.convertToViewportPoint(effective.x, effective.y);
              return (
                <g
                  key={ann.id}
                  className="pointer-events-auto cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (tool === 'select') onSelectAnnotation(ann.id);
                  }}
                >
                  <rect x={vx - 1} y={vy - 1} width={18} height={18} rx={3} fill="#fde047" stroke={selected ? '#2563eb' : '#ca8a04'} strokeWidth={selected ? 2 : 1} />
                  <title>{effective.text}</title>
                </g>
              );
            })}

            {draftRect && (() => {
              const x = Math.min(draftRect.x0, draftRect.x1);
              const y = Math.min(draftRect.y0, draftRect.y1);
              const r = rectToScreen({ x, y, width: Math.abs(draftRect.x1 - draftRect.x0), height: Math.abs(draftRect.y1 - draftRect.y0) }, viewport);
              const fill = tool === 'edit' ? 'rgba(37, 99, 235, 0.15)' : 'rgba(250, 204, 21, 0.4)';
              return <rect x={r.left} y={r.top} width={r.width} height={r.height} fill={fill} stroke={tool === 'edit' ? '#2563eb' : 'transparent'} strokeDasharray={tool === 'edit' ? '3 2' : undefined} />;
            })()}
            {draftPath && (
              <polyline
                points={draftPath.map((p) => viewport.convertToViewportPoint(p.x, p.y)).map(([x, y]) => `${x},${y}`).join(' ')}
                fill="none"
                stroke="#ef4444"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {editRunDrag.current?.moved && (() => {
              const d = editRunDrag.current;
              if (!d) return null;
              const r = rectToScreen({ ...runRedactBox(d.run), x: d.run.x + (d.curX - d.startX), y: d.run.y + (d.curY - d.startY) }, viewport);
              return <rect x={r.left} y={r.top} width={r.width} height={r.height} fill="rgba(37, 99, 235, 0.2)" stroke="#2563eb" strokeDasharray="3 2" />;
            })()}
          </svg>
        )}

        {viewport && selectedAnnotationId && tool === 'select' && !dragPreview && (() => {
          const ann = pageAnnotations.find((a) => a.id === selectedAnnotationId);
          if (!ann) return null;
          let anchor: { left: number; top: number };
          if (ann.type === 'highlight' || ann.type === 'redact' || ann.type === 'image') {
            anchor = rectToScreen(ann, viewport);
          } else if (ann.type === 'draw') {
            const [left, top] = viewport.convertToViewportPoint(ann.points[0].x, ann.points[0].y);
            anchor = { left, top };
          } else {
            const [left, top] = viewport.convertToViewportPoint(ann.x, ann.y);
            anchor = { left, top };
          }
          return (
            <button
              type="button"
              className="pointer-events-auto absolute rounded bg-destructive px-2 py-0.5 text-xs font-medium text-destructive-foreground shadow"
              style={{ left: anchor.left, top: anchor.top - 24 }}
              onClick={(e) => {
                e.stopPropagation();
                onDeleteAnnotation(ann.id);
              }}
            >
              Видалити
            </button>
          );
        })()}

        {viewport && pendingNote && (
          <div
            className="pointer-events-auto absolute z-10 w-48 rounded-md border border-border bg-popover p-2 shadow-lg"
            style={{ left: viewport.convertToViewportPoint(pendingNote.x, pendingNote.y)[0], top: viewport.convertToViewportPoint(pendingNote.x, pendingNote.y)[1] }}
          >
            <textarea
              autoFocus
              className="w-full resize-none rounded border border-input bg-background p-1 text-sm outline-none"
              rows={3}
              value={pendingNote.text}
              onChange={(e) => setPendingNote({ ...pendingNote, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setPendingNote(null);
              }}
              onBlur={() => {
                if (pendingNote.text.trim()) {
                  onAddAnnotation({ id: newId(), pageKey: page.key, type: 'note', x: pendingNote.x, y: pendingNote.y, text: pendingNote.text.trim() });
                }
                setPendingNote(null);
              }}
            />
          </div>
        )}

        {viewport && pendingText && (() => {
          const [left, top] = viewport.convertToViewportPoint(pendingText.x, pendingText.y - pendingText.fontSize * TEXT_LINE_HEIGHT * 0.2);
          return (
            <div
              className="pointer-events-auto absolute z-10 border border-primary bg-white/95 shadow-lg"
              style={{ left, top, width: Math.max(pendingText.width * zoom, 90) }}
            >
              <textarea
                autoFocus
                className="block w-full resize-none border-none bg-transparent p-0.5 outline-none"
                style={{ fontSize: pendingText.fontSize * zoom, lineHeight: TEXT_LINE_HEIGHT, fontFamily: 'Helvetica, Arial, sans-serif', color: '#111827' }}
                rows={Math.max(1, pendingText.text.split('\n').length)}
                value={pendingText.text}
                onChange={(e) => setPendingText({ ...pendingText, text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setPendingText(null);
                }}
                onBlur={commitPendingText}
              />
            </div>
          );
        })()}
      </div>
    </div>
  );
}
