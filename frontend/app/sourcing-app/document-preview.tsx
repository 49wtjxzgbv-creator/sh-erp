'use client';

import dynamic from 'next/dynamic';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

const Dxf2DViewer = dynamic(() => import('@/components/domain/files/dxf-2d-viewer').then((m) => m.Dxf2DViewer), { ssr: false });

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
          <div className="min-h-0 flex-1">
            {isDxf ? (
              <Dxf2DViewer url={doc.url} />
            ) : (
              <iframe src={doc.url} title={doc.name} className="h-full w-full border-0 bg-white" />
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
