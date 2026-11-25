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
export function Model3DViewer({
  src,
  onClose,
  adaptiveFraming = false,
}: {
  src: string;
  onClose: () => void;
  /**
   * "компоненти 3д так і відображаються збільшеними а не як були до цього
   * саме компоненти а не вироби" (2026-11-25): the aspect-ratio-driven
   * zoom/no-autorotate fix below was built for extremely elongated/flat
   * виробі (Assembly) models — applying it unconditionally also changed
   * how a regular Product's own (usually normal-proportioned) 3D model
   * looks, which nobody asked to change. Only `assemblies/[id]/page.tsx`
   * passes `true`; `product-sheet.tsx` keeps the original
   * autoRotate-on/pure-"auto"-framing behavior by leaving this unset.
   */
  adaptiveFraming?: boolean;
}) {
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
    el.disableZoom = false;
    el.autoRotate = !adaptiveFraming;
    // "зроби щоб можна було більше приближувати" (2026-11-25) — model-viewer's
    // own default minimum zoom distance is tuned for a roughly cube-shaped
    // model and doesn't let the user pinch/scroll nearly as close as useful
    // for inspecting one end/detail of an elongated real assembly. `5%`
    // (vs. the "auto" default, closer to 25-50% of the fitted distance)
    // lets the camera get much nearer before model-viewer clamps further
    // zoom.
    el.minCameraOrbit = 'auto auto 5%';
    el.interactionPrompt = 'none';
    el.shadowIntensity = 1;
    el.exposure = 1;
    el.src = src;

    // "чомусь не всі 3д моделі виробів відкриваються по центру екрана та не
    // приближуються наскільки того хочеться" (2026-11-25, real assemblies
    // 457185/457243/444685zb — confirmed via inspect-assembly-glb-bounds.ts
    // against the actual production .glb files): these aren't off-center
    // geometry, they're genuinely extreme shapes — a ~4.3m long conveyor
    // only 0.16-0.25m thick (26.6x), a flat panel 0.06m thick spanning
    // 2.3x3.4m (54.1x). Two compounding problems, not one:
    //  1. `autoRotate` (default on) spins the camera around the model's
    //     world Y-axis — for a shape elongated along a DIFFERENT axis, that
    //     sweep alternates between "edge-on" (looks like a tiny speck) and
    //     "broadside" (fills the frame) every few seconds, which reads as
    //     "sometimes centered, sometimes not, never quite right" even
    //     though each individual frame IS correctly centered. Turned off —
    //     the drag-to-rotate hint below already assumes manual exploration
    //     is the primary interaction, not a showcase spin.
    //  2. model-viewer's "auto" camera distance fits the bounding SPHERE
    //     (dominated by the longest dimension) — correct for a roughly
    //     cube-shaped part, but leaves an elongated/flat one looking tiny
    //     since its short dimension is dwarfed by the frame sized for its
    //     long one. `getDimensions()` (real decoded-mesh size, available
    //     once `load` fires) drives a tighter zoom specifically scaled to
    //     how extreme the shape's aspect ratio actually is, rather than one
    //     fixed percentage for every model regardless of shape.
    if (!adaptiveFraming) return;
    const handleLoad = () => {
      const { x, y, z } = el.getDimensions();
      const [largest, mid] = [x, y, z].sort((a, b) => b - a);
      const aspect = mid > 0 ? largest / mid : 1;
      const zoomPercent = aspect > 8 ? 45 : aspect > 3 ? 60 : 85;
      el.cameraOrbit = `auto auto ${zoomPercent}%`;
      el.jumpCameraToGoal();
    };
    el.addEventListener('load', handleLoad);
    return () => el.removeEventListener('load', handleLoad);
  }, [ready, src, adaptiveFraming]);

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
            style={{ top: 'calc(max(1rem, env(safe-area-inset-top)) + var(--tg-content-safe-area-top, 0px))' }}
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
