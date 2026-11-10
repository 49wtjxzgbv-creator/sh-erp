'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2 } from 'lucide-react';
import { getTelegramWebApp } from './telegram-webapp';

let modelViewerReady: Promise<void> | null = null;
function ensureModelViewerRegistered(): Promise<void> {
  if (!modelViewerReady) {
    modelViewerReady = import('@google/model-viewer').then(() => undefined);
  }
  return modelViewerReady;
}

/**
 * Full-screen 3D model viewer (2026-11-10 — "і 3д") — same portal/overlay
 * shape as `PhotoLightbox` (components/ui/photo-lightbox.tsx), but for a
 * product's `.glb` instead of a flat photo: orbit by drag, pinch/scroll to
 * zoom, via Google's `<model-viewer>` web component — the SAME library
 * `ArViewButton`/the BOM 3D viewer already use elsewhere in this app, just
 * rendered visibly here instead of hidden-for-AR-handoff-only.
 *
 * "відкривається але не крутиться" (2026-11-10 real user report): Telegram's
 * OWN vertical-swipe-to-minimize gesture was claiming the drag before
 * model-viewer's internal orbit-controls ever saw it — `disableVerticalSwipes`
 * (Bot API 7.7+) while this is open fixes that; `touchAction: 'none'` on the
 * element itself additionally stops the browser's own default touch-scroll
 * handling from competing for the same gesture.
 */
export function Model3DViewer({ src, onClose }: { src: string; onClose: () => void }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ensureModelViewerRegistered().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const webApp = getTelegramWebApp();
    webApp?.disableVerticalSwipes?.();
    return () => webApp?.enableVerticalSwipes?.();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/90">
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 z-10 rounded-full bg-black/60 p-3 text-white transition-colors hover:bg-black/80"
        aria-label="Закрити"
        style={{ top: 'max(1rem, env(safe-area-inset-top))' }}
      >
        <X className="h-7 w-7" />
      </button>
      {!ready ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-white" />
        </div>
      ) : (
        // Absolute, not a flex child (2026-11-09 known issue, see
        // ArViewButton's own comment: a near-zero-size target during the
        // first paint stalls model-viewer's internal render loop) —
        // `inset-0` on an already `fixed inset-0` ancestor guarantees a
        // real, non-zero pixel size from the very first frame, no flex
        // layout timing involved.
        <model-viewer
          src={src}
          camera-controls
          auto-rotate
          shadow-intensity="1"
          exposure="1"
          interaction-prompt="none"
          className="absolute inset-0"
          style={{ width: '100%', height: '100%', touchAction: 'none' }}
        />
      )}
      <p
        className="absolute inset-x-0 bottom-0 text-center text-xs text-white/60"
        style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
      >
        Потягніть, щоб обертати · Защипніть, щоб наблизити
      </p>
    </div>,
    document.body,
  );
}
