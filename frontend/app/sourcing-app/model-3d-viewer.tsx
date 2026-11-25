'use client';

import { useEffect, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X, Loader2 } from 'lucide-react';
import type { ModelViewerElement } from '@google/model-viewer';
import { getTelegramWebApp } from './telegram-webapp';

let modelViewerReady: Promise<void> | null = null;
function ensureModelViewerRegistered(): Promise<void> {
  if (!modelViewerReady) {
    modelViewerReady = import('@google/model-viewer').then(() => undefined);
  }
  return modelViewerReady;
}

/**
 * Full-screen 3D model viewer (2026-11-10 — "і 3д").
 *
 * "видно що фон напівпрозорий і на фоні веб застосунок, коли намагаюсь
 * крутити то рухається фон" (2026-11-10 — the ACTUAL root cause, after two
 * failed attempts at other fixes): this used to be a bare `createPortal`
 * div, not a Radix `Dialog` — `MobileSheet`/`ProductSheet` (the thing this
 * opens FROM) IS a Radix Dialog, which owns its own body-scroll-lock
 * bookkeeping (`react-remove-scroll` under the hood). A second, un-Radix'd
 * portal layered on top never registered with that lock, so the drag
 * gesture was being read as a scroll of whatever's underneath instead of
 * reaching model-viewer's own orbit controls at all — explains why NEITHER
 * rotate NOR zoom ever worked, regardless of the model-viewer property
 * fixes already applied. Rebuilt on the exact same `DialogPrimitive`
 * `MobileSheet` uses, so this nests into Radix's layering/scroll-lock
 * correctly instead of fighting it.
 */
export function Model3DViewer({ src, onClose }: { src: string; onClose: () => void }) {
  const [ready, setReady] = useState(false);
  const viewerRef = useRef<ModelViewerElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    ensureModelViewerRegistered().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Real JS properties, not JSX attributes — Lit's own recommended way to
  // drive a web component from React, no attribute-string round-trip.
  useEffect(() => {
    if (!ready) return;
    const el = viewerRef.current;
    if (!el) return;
    el.cameraControls = true;
    el.autoRotate = true;
    el.disableZoom = false;
    el.interactionPrompt = 'none';
    el.shadowIntensity = 1;
    el.exposure = 1;
    el.src = src;
  }, [ready, src]);

  useEffect(() => {
    const webApp = getTelegramWebApp();
    webApp?.disableVerticalSwipes?.();
    webApp?.expand();
    return () => webApp?.enableVerticalSwipes?.();
  }, []);

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/90" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-[100]"
          style={{ touchAction: 'none' }}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogPrimitive.Title className="sr-only">3D-перегляд товару</DialogPrimitive.Title>
          <DialogPrimitive.Close
            className="absolute right-4 z-10 rounded-full bg-black/60 p-3 text-white transition-colors hover:bg-black/80"
            aria-label="Закрити"
            style={{ top: 'max(1rem, env(safe-area-inset-top))' }}
          >
            <X className="h-7 w-7" />
          </DialogPrimitive.Close>
          {!ready ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-white" />
            </div>
          ) : (
            // Absolute, not a flex child (known issue: a near-zero-size
            // target during the first paint stalls model-viewer's internal
            // render loop) — `inset-0` on an already `fixed inset-0`
            // ancestor guarantees a real, non-zero pixel size from the
            // very first frame.
            <model-viewer ref={viewerRef} className="absolute inset-0" style={{ width: '100%', height: '100%', touchAction: 'none' }} />
          )}
          <p
            className="pointer-events-none absolute inset-x-0 bottom-0 text-center text-xs text-white/60"
            style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
          >
            Потягніть, щоб обертати · Защипніть, щоб наблизити
          </p>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
