'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
 * Full-screen 3D model viewer (2026-11-10 — "і 3д") — same portal/overlay
 * shape as `PhotoLightbox` (components/ui/photo-lightbox.tsx), but for a
 * product's `.glb` instead of a flat photo: orbit by drag, pinch/scroll to
 * zoom, via Google's `<model-viewer>` web component — the SAME library
 * `ArViewButton`/the BOM 3D viewer already use elsewhere in this app, just
 * rendered visibly here instead of hidden-for-AR-handoff-only.
 *
 * "відкривається але не крутиться... не можу крутити приближати і
 * віддаляти" (2026-11-10, STILL broken after a first attempted fix):
 * JSX boolean attributes on a custom element (`<model-viewer
 * camera-controls auto-rotate />`) go through React's generic
 * attribute-serialization path, not a guaranteed property set — Lit
 * (what model-viewer is built on) exposes real camelCase JS properties
 * for exactly this reason, and setting them directly via a ref is the
 * officially-recommended, unambiguous way to drive a Lit element from
 * React (no attribute-string round-trip involved at all). Switched to
 * that here instead of trusting JSX attribute pass-through.
 * `disableVerticalSwipes` + `touchAction: 'none'` on the WHOLE overlay
 * (not just the element) stay as defense-in-depth against Telegram's own
 * gesture recognizer competing for the same drag.
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

  // The actual fix: real JS properties, not JSX attributes — see header comment.
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

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return createPortal(
    // `touchAction: 'none'` on the WHOLE overlay, not just the element
    // inside it — if anything up the tree still claims the gesture before
    // it reaches model-viewer's own internal pointer handlers, this is
    // the backstop.
    <div className="fixed inset-0 z-[100] bg-black/90" style={{ touchAction: 'none' }}>
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
        // Absolute, not a flex child (known issue: a near-zero-size target
        // during the first paint stalls model-viewer's internal render
        // loop) — `inset-0` on an already `fixed inset-0` ancestor
        // guarantees a real, non-zero pixel size from the very first
        // frame, no flex layout timing involved.
        <model-viewer ref={viewerRef} className="absolute inset-0" style={{ width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      <p
        className="pointer-events-none absolute inset-x-0 bottom-0 text-center text-xs text-white/60"
        style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
      >
        Потягніть, щоб обертати · Защипніть, щоб наблизити
      </p>
    </div>,
    document.body,
  );
}
