'use client';

import { useEffect, useRef, useState } from 'react';
import { OPS, type PageViewport } from 'pdfjs-dist';
import { cn } from '@/lib/utils';
import { newId, type Annotation, type AnnotationTool, type ExistingImageRegion, type ExistingTextRun, type PdfSource, type TextFontFamily, type WorkingPage } from './types';
import { extractTextRuns } from './extract-text-runs';

/** On-screen approximation only — the exported PDF always uses the real embedded Roboto/Roboto Slab files (see scripts/copy-pdf-font.js), regardless of whether those exact faces happen to be installed on the viewer's system. */
const PREVIEW_FONT_STACK: Record<TextFontFamily, string> = {
  sans: 'Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: '"Roboto Slab", Georgia, "Times New Roman", serif',
};

const DEFAULT_TEXT_COLOR = '#111827';

/**
 * Recovers where each image XObject is actually drawn by walking the content
 * stream's save/transform(cm)/restore stack to the CTM in effect at each
 * `paintImageXObject`, then projecting the unit square (images are always
 * painted into (0,0)-(1,1) under the CTM, by PDF convention) through it — the
 * same "exact structural lookup, not a guessed rectangle" approach
 * getTextContent() gives for free for text. Verified by hand against
 * pdf-lib's own emitted operator list for `drawImage({x,y,width,height})`.
 */
function detectImageRegions(opList: { fnArray: number[]; argsArray: unknown[] }): ExistingImageRegion[] {
  function multiply(m1: number[], m2: number[]): number[] {
    return [
      m1[0] * m2[0] + m1[1] * m2[2],
      m1[0] * m2[1] + m1[1] * m2[3],
      m1[2] * m2[0] + m1[3] * m2[2],
      m1[2] * m2[1] + m1[3] * m2[3],
      m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
      m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
    ];
  }

  const regions: ExistingImageRegion[] = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    if (fn === OPS.save) {
      stack.push(ctm);
    } else if (fn === OPS.restore) {
      ctm = stack.pop() ?? ctm;
    } else if (fn === OPS.transform) {
      ctm = multiply(opList.argsArray[i] as number[], ctm);
    } else if (fn === OPS.paintImageXObject || fn === OPS.paintImageXObjectRepeat) {
      const corners = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ].map(([ux, uy]) => [ux * ctm[0] + uy * ctm[2] + ctm[4], ux * ctm[1] + uy * ctm[3] + ctm[5]]);
      const xs = corners.map((c) => c[0]);
      const ys = corners.map((c) => c[1]);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      const width = Math.max(...xs) - x;
      const height = Math.max(...ys) - y;
      if (width > 2 && height > 2) regions.push({ x, y, width, height });
    }
  }
  return regions;
}

type EditTarget = { kind: 'text'; run: ExistingTextRun } | { kind: 'image'; region: ExistingImageRegion };

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
  /** PDF-point-space rect of the currently active search result on THIS page, if any — see pdf-search.ts. Null/undefined on every page but the one holding the active match. */
  searchHighlightRect?: { x: number; y: number; width: number; height: number } | null;
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
  fontFamily: TextFontFamily;
  color: string;
  text: string;
  /** Set only when this editor is replacing an existing run (the 'edit' tool) — committed alongside the new 'text' annotation so the original glyphs are hidden. Absent for a brand-new text block (the 'text' tool) or when re-editing an already-committed text annotation. */
  redactOriginal?: { x: number; y: number; width: number; height: number };
  /** The run's original string/size, to skip committing anything at all if the user opened an existing run and closed it with no actual change (text, font, size, or color). */
  originalText?: string;
  originalFontSize?: number;
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
  searchHighlightRect,
}: PdfPageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<PageViewport | null>(null);
  const textRunsRef = useRef<ExistingTextRun[]>([]);
  const imageRegionsRef = useRef<ExistingImageRegion[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const [draftRect, setDraftRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [draftPath, setDraftPath] = useState<{ x: number; y: number }[] | null>(null);
  const [pendingNote, setPendingNote] = useState<{ x: number; y: number; text: string } | null>(null);
  const [pendingText, setPendingText] = useState<PendingTextEditor | null>(null);
  const [hoverTarget, setHoverTarget] = useState<EditTarget | null>(null);
  const [dragPreview, setDragPreview] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const dragging = useRef(false);
  const shapeDragOrigin = useRef<{ x: number; y: number } | null>(null);
  const pendingTextPopupRef = useRef<HTMLDivElement>(null);
  const editDrag = useRef<{ target: EditTarget; startX: number; startY: number; curX: number; curY: number; moved: boolean } | null>(null);

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
        const runs = await extractTextRuns(pdfPage);
        if (!cancelled) textRunsRef.current = runs;
      } catch (err) {
        // Text layer is a nice-to-have for the 'edit' tool — a page this fails on just can't have its existing text edited, everything else still works.
        console.error('PDF text layer extraction failed (existing-text editing unavailable on this page)', err);
      }

      try {
        const opList = await pdfPage.getOperatorList();
        if (!cancelled) imageRegionsRef.current = detectImageRegions(opList);
      } catch (err) {
        // Same nice-to-have reasoning as the text layer above — a page this fails on just can't have its existing images auto-detected for moving.
        console.error('PDF image region detection failed (existing-image auto-move unavailable on this page)', err);
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

  function findImageRegionAt(x: number, y: number): ExistingImageRegion | null {
    const regions = imageRegionsRef.current;
    for (let i = regions.length - 1; i >= 0; i--) {
      const r = regions[i];
      if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) return r;
    }
    return null;
  }

  function findEditTargetAt(x: number, y: number): EditTarget | null {
    const run = findTextRunAt(x, y);
    if (run) return { kind: 'text', run };
    const region = findImageRegionAt(x, y);
    if (region) return { kind: 'image', region };
    return null;
  }

  // Opening a new editor while one is already pending reuses the SAME
  // popup/textarea DOM node (just a props update, not an unmount/remount
  // — React has no reason to recreate it), so no native 'blur' ever fires
  // on the old one to trigger commitPendingText via onBlur. Without this,
  // clicking a second spot while still in the 'text' tool silently threw
  // away whatever was just typed (2026-10-27 bug report: "після того як
  // ввів текст і клікнув в іншому місці він має зберігатись").
  function openTextEditor(editor: PendingTextEditor) {
    if (pendingText) commitPendingText();
    setPendingText(editor);
  }

  // Same reuse-not-remount issue as openTextEditor above, for the 'note' tool.
  function commitPendingNote() {
    if (pendingNote && pendingNote.text.trim()) {
      onAddAnnotation({ id: newId(), pageKey: page.key, type: 'note', x: pendingNote.x, y: pendingNote.y, text: pendingNote.text.trim() });
    }
    setPendingNote(null);
  }

  function openNoteEditor(note: { x: number; y: number; text: string }) {
    if (pendingNote) commitPendingNote();
    setPendingNote(note);
  }

  function commitPendingText() {
    const pt = pendingText;
    setPendingText(null);
    if (!pt) return;
    const text = pt.text.trim();

    if (pt.editingAnnotationId) {
      if (text) {
        onUpdateAnnotation(pt.editingAnnotationId, { text, fontSize: pt.fontSize, fontFamily: pt.fontFamily, color: pt.color } as Partial<Annotation>);
      } else {
        onDeleteAnnotation(pt.editingAnnotationId);
      }
      return;
    }

    if (
      pt.redactOriginal &&
      text === (pt.originalText ?? '').trim() &&
      pt.fontFamily === 'sans' &&
      pt.color === DEFAULT_TEXT_COLOR &&
      pt.fontSize === pt.originalFontSize
    ) {
      return; // opened an existing run, closed it with no actual change — nothing to do
    }

    if (!text) return;
    if (pt.redactOriginal) {
      onAddAnnotation({ id: newId(), pageKey: page.key, type: 'redact', ...pt.redactOriginal });
    }
    onAddAnnotation({ id: newId(), pageKey: page.key, type: 'text', x: pt.x, y: pt.y, width: pt.width, fontSize: pt.fontSize, fontFamily: pt.fontFamily, color: pt.color, text });
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
    // Real (trusted) clicks fire a native compat `mousedown` right after
    // `pointerdown` — its own DEFAULT action steals focus to/from the
    // overlay div (not focusable) independently of anything React does.
    // Without this, that native focus-steal lands AFTER React has already
    // synchronously committed and autofocused the 'text'/'note' popup's
    // <textarea>, immediately blurring it and closing the just-opened
    // editor — invisible to a synthetic (untrusted) dispatched event,
    // which skips native default actions entirely, which is why this only
    // reproduced via a real click (2026-10-27 bug report: "клікаю на
    // текст, нічого не відбувається"). Per the Pointer Events spec,
    // preventDefault() on pointerdown suppresses that compat mousedown
    // (and its focus-stealing default action) from firing at all.
    e.preventDefault();

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
      openNoteEditor({ x, y, text: '' });
    } else if (tool === 'text') {
      openTextEditor({ x, y, width: 180, fontSize: 14, fontFamily: 'sans', color: DEFAULT_TEXT_COLOR, text: '' });
    } else if (tool === 'edit') {
      const target = findEditTargetAt(x, y);
      if (target) {
        dragging.current = true;
        editDrag.current = { target, startX: x, startY: y, curX: x, curY: y, moved: false };
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
      setHoverTarget(findEditTargetAt(x, y));
    }

    if (!dragging.current) return;
    const [x, y] = screenToPdf(e.clientX, e.clientY);
    if (editDrag.current) {
      const d = editDrag.current;
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

  /** Cuts the given PDF-space region's CURRENT pixels off the canvas, covers the original with a 'redact', and drops the cut bitmap at (region.x+dx, region.y+dy) as a new movable 'image' annotation. The one pipeline behind both the auto-detected-image drag (dx/dy = the drag delta) and the manual freehand fallback (dx=dy=0 — appears in place, move it afterward via "Вибір"). */
  function captureAndPlaceImage(region: { x: number; y: number; width: number; height: number }, dx: number, dy: number) {
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    if (!canvas || !viewport || region.width < 4 || region.height < 4) return;
    const r = rectToScreen(region, viewport);
    if (r.width < 4 || r.height < 4) return;
    const temp = document.createElement('canvas');
    temp.width = Math.round(r.width);
    temp.height = Math.round(r.height);
    const ctx = temp.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(canvas, r.left, r.top, r.width, r.height, 0, 0, temp.width, temp.height);
    const dataUrl = temp.toDataURL('image/png');
    onAddAnnotation({ id: newId(), pageKey: page.key, type: 'redact', ...region });
    onAddAnnotation({ id: newId(), pageKey: page.key, type: 'image', x: region.x + dx, y: region.y + dy, width: region.width, height: region.height, dataUrl });
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

    if (editDrag.current) {
      const d = editDrag.current;
      editDrag.current = null;
      const dx = d.curX - d.startX;
      const dy = d.curY - d.startY;

      if (d.target.kind === 'image') {
        if (d.moved) captureAndPlaceImage(d.target.region, dx, dy);
        // A plain click on an existing image (no drag) is a no-op — there's no "retype" equivalent for a picture, so don't clutter the page with an unwanted cut.
        return;
      }

      const run = d.target.run;
      if (d.moved) {
        onAddAnnotation({ id: newId(), pageKey: page.key, type: 'redact', ...runRedactBox(run) });
        onAddAnnotation({
          id: newId(),
          pageKey: page.key,
          type: 'text',
          x: run.x + dx,
          y: run.y + dy,
          width: run.width,
          fontSize: run.fontSize,
          fontFamily: 'sans',
          color: DEFAULT_TEXT_COLOR,
          text: run.str,
        });
      } else {
        openTextEditor({
          x: run.x,
          y: run.y,
          width: Math.max(run.width, 120),
          fontSize: run.fontSize,
          fontFamily: 'sans',
          color: DEFAULT_TEXT_COLOR,
          text: run.str,
          redactOriginal: runRedactBox(run),
          originalText: run.str,
          originalFontSize: run.fontSize,
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
      captureAndPlaceImage({ x, y, width, height }, 0, 0);
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
          tool === 'edit' && (hoverTarget ? 'cursor-move' : 'cursor-crosshair'),
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {viewport && (
          <svg className="pointer-events-none absolute inset-0 overflow-visible" width={size.width} height={size.height}>
            {searchHighlightRect && (() => {
              const r = rectToScreen(searchHighlightRect, viewport);
              return <rect x={r.left - 2} y={r.top - 2} width={r.width + 4} height={r.height + 4} rx={2} fill="rgba(249, 115, 22, 0.45)" stroke="#ea580c" strokeWidth={2} />;
            })()}

            {tool === 'edit' && hoverTarget && !editDrag.current && (() => {
              const box = hoverTarget.kind === 'text' ? runRedactBox(hoverTarget.run) : hoverTarget.region;
              const r = rectToScreen(box, viewport);
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
                      openTextEditor({
                        x: effective.x,
                        y: effective.y,
                        width: effective.width,
                        fontSize: effective.fontSize,
                        fontFamily: effective.fontFamily,
                        color: effective.color,
                        text: effective.text,
                        editingAnnotationId: ann.id,
                      });
                    }}
                  >
                    {selected && <rect x={bbox.left} y={bbox.top} width={bbox.width} height={bbox.height} fill="none" stroke="#2563eb" strokeDasharray="4 2" />}
                    {lines.map((line, i) => {
                      const [lx, ly] = viewport.convertToViewportPoint(effective.x, effective.y - i * lineHeight);
                      return (
                        <text key={i} x={lx} y={ly} fontSize={effective.fontSize * zoom} fontFamily={PREVIEW_FONT_STACK[effective.fontFamily]} fill={selected ? '#2563eb' : effective.color}>
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
            {editDrag.current?.moved && (() => {
              const d = editDrag.current;
              if (!d) return null;
              const box = d.target.kind === 'text' ? runRedactBox(d.target.run) : d.target.region;
              const dx = d.curX - d.startX;
              const dy = d.curY - d.startY;
              const r = rectToScreen({ ...box, x: box.x + dx, y: box.y + dy }, viewport);
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
            onPointerDown={(e) => e.stopPropagation()}
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
              onBlur={commitPendingNote}
            />
          </div>
        )}

        {viewport && pendingText && (() => {
          const [left, top] = viewport.convertToViewportPoint(pendingText.x, pendingText.y - pendingText.fontSize * TEXT_LINE_HEIGHT * 0.2);
          // Clicking a toolbar control (font/size/color) shifts DOM focus away from the textarea, which would
          // otherwise fire its onBlur and close the editor mid-edit — only commit once focus leaves the WHOLE
          // popup, not just the textarea within it.
          function handlePopupBlur(e: React.FocusEvent) {
            if (pendingTextPopupRef.current?.contains(e.relatedTarget as Node)) return;
            commitPendingText();
          }
          return (
            <div
              ref={pendingTextPopupRef}
              className="pointer-events-auto absolute z-10 border border-primary bg-white shadow-lg"
              style={{ left, top, width: Math.max(pendingText.width * zoom, 160) }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-1 border-b border-border bg-secondary/40 px-1 py-1">
                <div className="flex overflow-hidden rounded border border-input">
                  {(['sans', 'serif'] as const).map((family) => (
                    <button
                      key={family}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setPendingText({ ...pendingText, fontFamily: family })}
                      className={cn(
                        'px-1.5 py-0.5 text-xs',
                        pendingText.fontFamily === family ? 'bg-primary text-primary-foreground' : 'bg-background text-foreground hover:bg-secondary',
                      )}
                      style={{ fontFamily: PREVIEW_FONT_STACK[family] }}
                      title={family === 'sans' ? 'Roboto' : 'Roboto Slab'}
                    >
                      Aa
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  min={6}
                  max={96}
                  value={pendingText.fontSize}
                  onChange={(e) => setPendingText({ ...pendingText, fontSize: Math.max(6, Math.min(96, Number(e.target.value) || pendingText.fontSize)) })}
                  onBlur={handlePopupBlur}
                  className="h-6 w-12 rounded border border-input bg-background px-1 text-xs tabular-nums outline-none"
                />
                <input
                  type="color"
                  value={pendingText.color}
                  onChange={(e) => setPendingText({ ...pendingText, color: e.target.value })}
                  onBlur={handlePopupBlur}
                  className="h-6 w-6 cursor-pointer rounded border border-input bg-background p-0.5"
                  title="Колір тексту"
                />
              </div>
              <textarea
                autoFocus
                className="block w-full resize-none border-none bg-transparent p-0.5 outline-none"
                style={{ fontSize: pendingText.fontSize * zoom, lineHeight: TEXT_LINE_HEIGHT, fontFamily: PREVIEW_FONT_STACK[pendingText.fontFamily], color: pendingText.color }}
                rows={Math.max(1, pendingText.text.split('\n').length)}
                value={pendingText.text}
                onChange={(e) => setPendingText({ ...pendingText, text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setPendingText(null);
                }}
                onBlur={handlePopupBlur}
              />
            </div>
          );
        })()}
      </div>
    </div>
  );
}
