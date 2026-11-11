'use client';

import { useEffect, useRef, useState } from 'react';
import '@/lib/pdfjs-worker';
import { getDocument } from 'pdfjs-dist';

/**
 * "передперегляд показує тільки 1 сторінку пдф файла" (2026-11-11) —
 * `DocumentPreview` used to render PDFs via a plain `<iframe src={url}>`,
 * relying on the WebView's own native PDF plugin — Telegram's embedded
 * WebView apparently has none (or a partial one), rendering only the
 * first page. Renders every page itself instead, each onto its own
 * `<canvas>` via pdfjs-dist (`lib/pdfjs-worker.ts`'s already-configured
 * worker), stacked in one scrollable column — same "fetch bytes, hand to
 * pdfjs" shape `Dxf2DViewer`/`Step3DViewer` already use for their own
 * presigned R2 URLs (confirms R2's CORS already allows this fetch from
 * this app's own origin).
 */
export function PdfMultiPageViewer({ url }: { url: string }) {
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
      const containerWidth = container.clientWidth || 360;
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

  return (
    <div className="h-full w-full overflow-y-auto bg-white p-2">
      {loading && <p className="p-6 text-center text-sm text-gray-500">Завантаження…</p>}
      {error && <p className="p-6 text-center text-sm text-red-500">{error}</p>}
      <div ref={containerRef} />
    </div>
  );
}
