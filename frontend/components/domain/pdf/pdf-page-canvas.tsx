'use client';

import { useEffect, useRef, useState } from 'react';
import type { PageViewport } from 'pdfjs-dist';
import { cn } from '@/lib/utils';
import { newId, type Annotation, type AnnotationTool, type PdfSource, type WorkingPage } from './types';

interface PdfPageCanvasProps {
  page: WorkingPage;
  source: PdfSource;
  zoom: number;
  tool: AnnotationTool;
  annotations: Annotation[];
  selectedAnnotationId: string | null;
  onAddAnnotation: (annotation: Annotation) => void;
  onSelectAnnotation: (id: string | null) => void;
  onDeleteAnnotation: (id: string) => void;
}

/** Bounding box of a PDF-space rectangle, projected into the CURRENT viewport's screen pixels. A rect's corners stay axis-aligned after any 90°-multiple rotation, so min/max over the 4 projected corners is always correct — this is simpler than tracking "which corner is top-left" through a rotation. */
function highlightToScreenRect(ann: { x: number; y: number; width: number; height: number }, viewport: PageViewport) {
  const corners = [
    viewport.convertToViewportPoint(ann.x, ann.y),
    viewport.convertToViewportPoint(ann.x + ann.width, ann.y),
    viewport.convertToViewportPoint(ann.x, ann.y + ann.height),
    viewport.convertToViewportPoint(ann.x + ann.width, ann.y + ann.height),
  ];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
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
 */
export function PdfPageCanvas({
  page,
  source,
  zoom,
  tool,
  annotations,
  selectedAnnotationId,
  onAddAnnotation,
  onSelectAnnotation,
  onDeleteAnnotation,
}: PdfPageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<PageViewport | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const [draftRect, setDraftRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [draftPath, setDraftPath] = useState<{ x: number; y: number }[] | null>(null);
  const [pendingNote, setPendingNote] = useState<{ x: number; y: number; text: string } | null>(null);
  const dragging = useRef(false);

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

  function handlePointerDown(e: React.PointerEvent) {
    if (tool === 'select') {
      if (e.target === overlayRef.current) onSelectAnnotation(null);
      return;
    }
    const [x, y] = screenToPdf(e.clientX, e.clientY);
    dragging.current = true;
    overlayRef.current?.setPointerCapture(e.pointerId);
    if (tool === 'highlight') {
      setDraftRect({ x0: x, y0: y, x1: x, y1: y });
    } else if (tool === 'draw') {
      setDraftPath([{ x, y }]);
    } else if (tool === 'note') {
      setPendingNote({ x, y, text: '' });
    }
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    const [x, y] = screenToPdf(e.clientX, e.clientY);
    if (tool === 'highlight' && draftRect) {
      setDraftRect({ ...draftRect, x1: x, y1: y });
    } else if (tool === 'draw' && draftPath) {
      setDraftPath([...draftPath, { x, y }]);
    }
  }

  function handlePointerUp(e: React.PointerEvent) {
    dragging.current = false;
    overlayRef.current?.releasePointerCapture(e.pointerId);
    if (tool === 'highlight' && draftRect) {
      const x = Math.min(draftRect.x0, draftRect.x1);
      const y = Math.min(draftRect.y0, draftRect.y1);
      const width = Math.abs(draftRect.x1 - draftRect.x0);
      const height = Math.abs(draftRect.y1 - draftRect.y0);
      setDraftRect(null);
      if (width > 2 && height > 2) {
        onAddAnnotation({ id: newId(), pageKey: page.key, type: 'highlight', x, y, width, height });
      }
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
          tool === 'highlight' && 'cursor-crosshair',
          tool === 'draw' && 'cursor-crosshair',
          tool === 'note' && 'cursor-copy',
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {viewport && (
          <svg className="pointer-events-none absolute inset-0 overflow-visible" width={size.width} height={size.height}>
            {pageAnnotations.map((ann) => {
              const selected = ann.id === selectedAnnotationId;
              if (ann.type === 'highlight') {
                const r = highlightToScreenRect(ann, viewport);
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
              if (ann.type === 'draw') {
                const pts = ann.points.map((p) => viewport.convertToViewportPoint(p.x, p.y));
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
              const [vx, vy] = viewport.convertToViewportPoint(ann.x, ann.y);
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
                  <title>{ann.text}</title>
                </g>
              );
            })}

            {draftRect && (() => {
              const x = Math.min(draftRect.x0, draftRect.x1);
              const y = Math.min(draftRect.y0, draftRect.y1);
              const r = highlightToScreenRect({ x, y, width: Math.abs(draftRect.x1 - draftRect.x0), height: Math.abs(draftRect.y1 - draftRect.y0) }, viewport);
              return <rect x={r.left} y={r.top} width={r.width} height={r.height} fill="rgba(250, 204, 21, 0.4)" />;
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
          </svg>
        )}

        {viewport && selectedAnnotationId && tool === 'select' && (() => {
          const ann = pageAnnotations.find((a) => a.id === selectedAnnotationId);
          if (!ann) return null;
          let anchor: { left: number; top: number };
          if (ann.type === 'highlight') {
            anchor = highlightToScreenRect(ann, viewport);
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
      </div>
    </div>
  );
}
