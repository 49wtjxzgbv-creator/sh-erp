'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { getTelegramWebApp } from './telegram-webapp';

const Dxf2DViewer = dynamic(() => import('@/components/domain/files/dxf-2d-viewer').then((m) => m.Dxf2DViewer), { ssr: false });
const PdfMultiPageViewer = dynamic(() => import('./pdf-multi-page-viewer').then((m) => m.PdfMultiPageViewer), { ssr: false });

/**
 * "не скачування файлів має бути а також передперегляд dxf pdf файлів"
 * (2026-11-10) — in-app preview instead of `openLink`/download. Built
 * directly on `DialogPrimitive`, not a bare portal, same reasoning as
 * `Model3DViewer`'s own header comment: this opens FROM the already-open
 * `ProductSheet` Radix Dialog, so it must join that Dialog's own
 * body-scroll-lock bookkeeping or gestures fall through to the page
 * underneath instead of reaching the preview.
 */
export function DocumentPreview({ doc, onClose }: { doc: { id: string; name: string; url: string } | null; onClose: () => void }) {
  // Same gesture conflict `Model3DViewer` already documents and fixes
  // (2026-11-10): the DXF branch below has its own pointer-driven
  // pan/pinch-zoom, exposed to the exact same fight with Telegram's
  // vertical-swipe-to-minimize gesture unless explicitly disabled. The
  // hook itself always runs (this component stays mounted with `doc`
  // toggling null/non-null, unlike `Model3DViewer` which mounts/unmounts
  // whole) — only the effect's BODY is conditioned on `doc`, so the hook
  // count never changes across renders.
  useEffect(() => {
    if (!doc) return;
    const webApp = getTelegramWebApp();
    webApp?.disableVerticalSwipes?.();
    return () => webApp?.enableVerticalSwipes?.();
  }, [doc]);

  if (!doc) return null;
  const isDxf = /\.dxf$/i.test(doc.name);

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/90" />
        <DialogPrimitive.Content className="fixed inset-0 z-[100] flex flex-col" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogPrimitive.Title className="sr-only">{doc.name}</DialogPrimitive.Title>
          <div
            className="flex shrink-0 items-center justify-between gap-2 p-3"
            style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
          >
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-white">{doc.name}</p>
            <DialogPrimitive.Close
              className="shrink-0 rounded-full bg-black/60 p-2 text-white transition-colors hover:bg-black/80"
              aria-label="Закрити"
            >
              <X className="h-5 w-5" />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            {isDxf ? <Dxf2DViewer url={doc.url} /> : <PdfMultiPageViewer url={doc.url} />}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
