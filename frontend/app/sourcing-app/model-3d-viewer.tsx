'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2 } from 'lucide-react';

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
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-black/90">
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 z-10 rounded-full bg-black/60 p-3 text-white transition-colors hover:bg-black/80"
        aria-label="Закрити"
        style={{ top: 'max(1rem, env(safe-area-inset-top))' }}
      >
        <X className="h-7 w-7" />
      </button>
      {!ready ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-white" />
        </div>
      ) : (
        <model-viewer
          src={src}
          camera-controls
          auto-rotate
          shadow-intensity="1"
          exposure="1"
          interaction-prompt="none"
          style={{ width: '100%', height: '100%', flex: 1 }}
        />
      )}
      <p className="pb-6 text-center text-xs text-white/60" style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
        Потягніть, щоб обертати · Защипніть, щоб наблизити
      </p>
    </div>,
    document.body,
  );
}
