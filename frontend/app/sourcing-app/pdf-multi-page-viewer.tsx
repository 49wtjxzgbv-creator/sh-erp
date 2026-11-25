'use client';

import { useEffect, useRef, useState } from 'react';
import '@/lib/pdfjs-worker';
import { getDocument } from 'pdfjs-dist';

/**
 * "коли в вебзастосунку телеграм відкриваємо пдф файли то не можемо
 * приблизити їх" (2026-11-25): there's no bug to fix in isolation here —
 * the whole sourcing-app route deliberately disables the BROWSER's native
 * pinch-zoom (`maximumScale: 1, userScalable: false` in layout.tsx, so a
 * stray two-finger tap on a button elsewhere never zooms the whole UI),
 * which also takes the PDF viewer's only zoom mechanism down with it since
 * it never had one of its own. Two-finger pinch here is handled by hand —
 * a CSS `transform: scale()` on `contentRef`, with `sizerRef` matching
 * its SCALED footprint so the ALREADY-`overflow-auto` container gets real
 * scrollbars/pan range at any zoom level, not just at 1x. Deliberately
 * NOT implemented as a page re-render-per-pinch-frame (pdf.js rendering
 * isn't cheap enough to track a live gesture at 60fps) — the canvases
 * stay at their one fixed `outputScale` (device pixel ratio) resolution;
 * CSS-scaling up a few times over that still reads reasonably sharp.
 * Single-finger touches are left completely alone so normal vertical
 * page-to-page scrolling keeps working exactly as before.
 */
export function PdfMultiPageViewer({ url }: { url: string }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const sizerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      const bytes = await fetch(url).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      });
      if (cancelled) return;
      const pdfDoc = await getDocument({ data: bytes }).promise;
      if (cancelled) return;

      const container = containerRef.current;
      if (!container) return;
      container.innerHTML = '';
      const containerWidth = outerRef.current?.clientWidth || 360;
      const outputScale = window.devicePixelRatio || 1;

      for (let pageNumber = 1; pageNumber <= pdfDoc.numPages; pageNumber++) {
        if (cancelled) return;
        const page = await pdfDoc.getPage(pageNumber);
        const unscaled = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: containerWidth / unscaled.width });

        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = '100%';
        canvas.style.height = 'auto';
        canvas.style.display = 'block';
        canvas.style.marginBottom = '8px';
        canvas.style.boxShadow = '0 0 0 1px rgba(0,0,0,0.08)';
        container.appendChild(canvas);

        await page.render({
          canvas,
          viewport,
          transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
        }).promise;
      }
    })()
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Не вдалося завантажити PDF.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  // Two-finger pinch-to-zoom — see this file's own header comment for why
  // this exists at all (the route's global viewport disables native pinch).
  useEffect(() => {
    const outer = outerRef.current;
    const sizer = sizerRef.current;
    const content = contentRef.current;
    if (!outer || !sizer || !content) return;

    let scale = 1;
    const MIN_SCALE = 1;
    const MAX_SCALE = 4;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchStartDist = 0;
    let pinchStartScale = 1;
    let naturalWidth = 0;
    let naturalHeight = 0;

    function applyScale(newScale: number) {
      scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale));
      content!.style.transform = `scale(${scale})`;
      sizer!.style.width = `${naturalWidth * scale}px`;
      sizer!.style.height = `${naturalHeight * scale}px`;
    }

    function onPointerDown(e: PointerEvent) {
      if (e.pointerType !== 'touch') return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        naturalWidth = content!.scrollWidth;
        naturalHeight = content!.scrollHeight;
        const pts = [...pointers.values()];
        pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        pinchStartScale = scale;
      }
    }
    function onPointerMove(e: PointerEvent) {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        e.preventDefault();
        const pts = [...pointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        applyScale(pinchStartScale * (dist / pinchStartDist));
      }
    }
    function onPointerUp(e: PointerEvent) {
      pointers.delete(e.pointerId);
    }

    outer.addEventListener('pointerdown', onPointerDown);
    outer.addEventListener('pointermove', onPointerMove, { passive: false });
    outer.addEventListener('pointerup', onPointerUp);
    outer.addEventListener('pointercancel', onPointerUp);
    return () => {
      outer.removeEventListener('pointerdown', onPointerDown);
      outer.removeEventListener('pointermove', onPointerMove);
      outer.removeEventListener('pointerup', onPointerUp);
      outer.removeEventListener('pointercancel', onPointerUp);
    };
  }, [loading]);

  return (
    <div ref={outerRef} className="h-full w-full overflow-auto bg-white p-2" style={{ touchAction: 'pan-x pan-y' }}>
      {loading && <p className="p-6 text-center text-sm text-gray-500">Завантаження…</p>}
      {error && <p className="p-6 text-center text-sm text-red-500">{error}</p>}
      <div ref={sizerRef}>
        <div ref={contentRef} style={{ transformOrigin: 'top left' }}>
          <div ref={containerRef} />
        </div>
      </div>
    </div>
  );
}
