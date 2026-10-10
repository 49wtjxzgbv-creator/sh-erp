'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Camera, Loader2 } from 'lucide-react';
import type { ModelViewerElement } from '@google/model-viewer';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/hooks/use-toast';

// "натискаю і дуже довго грузиться" (2026-10-10 real user report): the
// hidden `<model-viewer>` loading the .glb can fail outright (bad URL,
// CORS, a malformed file) — model-viewer fires its own `error` event in
// that case, not `load`, so waiting on `load` alone left the button spun
// up in "Підготовка AR…" forever with no feedback at all. This bounds the
// wait even if NEITHER event ever fires (a genuinely stalled fetch).
const LOAD_TIMEOUT_MS = 25_000;

function isMobileDevice(): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export interface ArViewButtonProps {
  /**
   * Lazily resolves to a publicly fetchable https URL of a standalone .glb
   * — must NOT be a `blob:` URL. Android's Scene Viewer activates via an
   * `intent://` handoff to a separate app process that can't dereference a
   * page-scoped blob; only iOS Quick Look (same-process Safari handoff)
   * would tolerate one. Called once per click, so the caller can export +
   * upload on demand (see `assembly-parts-check-viewer.tsx`'s
   * `handleActivateAr`) rather than paying that cost for every part up
   * front. Resolving to `null` surfaces nothing — the caller is expected to
   * have already reported its own error (e.g. a toast).
   */
  getGlbUrl: () => Promise<string | null>;
  className?: string;
}

let modelViewerReady: Promise<void> | null = null;
function ensureModelViewerRegistered(): Promise<void> {
  if (!modelViewerReady) {
    modelViewerReady = import('@google/model-viewer').then(() => undefined);
  }
  return modelViewerReady;
}

/**
 * "поставити цю 3D-деталь прямо на підлогу в цеху в реальному розмірі 1:1"
 * (2026-10-10): wraps Google's `<model-viewer>` web component purely for
 * its AR handoff — iOS Safari gets AR Quick Look (model-viewer converts the
 * .glb to .usdz in-browser the moment AR is activated, no backend
 * conversion needed), Android Chrome gets Google Scene Viewer via an
 * `intent://` URL it builds itself. Neither actually needs a visible 3D
 * canvas on OUR page (Quick Look/Scene Viewer fully take over as native
 * handoffs), so the `<model-viewer>` element itself stays visually hidden
 * and permanently mounted (never conditionally rendered on the resolved
 * URL — swapping `.src` as a property on an already-mounted element is the
 * only way to reliably await its own `load` event; mounting a fresh
 * element only once a URL exists races the ref against React's own commit
 * timing). `ar-scale="fixed"` (no pinch-resizing) + `ar-placement="floor"`
 * keep the model at its real authored size and anchored to the floor —
 * matching "в реальному розмірі 1:1" exactly, same real-world units
 * already behind `dimensionsMm` elsewhere in this viewer.
 *
 * Gated on `isMobileDevice()` rather than model-viewer's own
 * `canActivateAR` — that only becomes accurate AFTER a model is loaded
 * into it, which would mean exporting+uploading a part's .glb (this
 * button's whole `getGlbUrl` cost) just to find out AR isn't relevant on a
 * desktop review session. A phone that genuinely lacks ARCore/ARKit still
 * shows the button; tapping it just won't do anything, which matches what
 * `activateAR()` itself does on an unsupported device anyway.
 */
export function ArViewButton({ getGlbUrl, className }: ArViewButtonProps) {
  const t = useTranslations('files');
  const ref = useRef<ModelViewerElement | null>(null);
  const loadedSrcRef = useRef<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  if (!isMobileDevice()) return null;

  async function handleClick() {
    setPreparing(true);
    try {
      await ensureModelViewerRegistered();
      const url = await getGlbUrl();
      const el = ref.current;
      if (!url || !el) return;
      if (loadedSrcRef.current !== url) {
        const loaded = await new Promise<boolean>((resolve) => {
          const cleanup = () => {
            el.removeEventListener('load', onLoad);
            el.removeEventListener('error', onError);
            clearTimeout(timer);
          };
          const onLoad = () => {
            cleanup();
            loadedSrcRef.current = url;
            resolve(true);
          };
          const onError = () => {
            cleanup();
            resolve(false);
          };
          const timer = setTimeout(() => {
            cleanup();
            resolve(false);
          }, LOAD_TIMEOUT_MS);
          el.addEventListener('load', onLoad);
          el.addEventListener('error', onError);
          el.src = url;
        });
        if (!loaded) {
          toast.error(t('arLoadFailed'));
          return;
        }
      }
      await el.activateAR();
    } finally {
      setPreparing(false);
    }
  }

  return (
    <>
      <model-viewer
        ref={ref}
        ar
        ar-modes="webxr scene-viewer quick-look"
        ar-scale="fixed"
        ar-placement="floor"
        // "натискаю і дуже довго грузиться" (2026-10-10 real user report,
        // reproduced live): a 1x1px box left model-viewer's own internal
        // render loop stalling on a near-zero-size target — confirmed via
        // its own console warning ("rAF timed out in updateSource") — which
        // stretched a 587KB file's load out to over a minute instead of
        // failing fast or loading quickly. `position: fixed` (immune to any
        // ancestor's overflow/scroll clipping — this renders inside table
        // cells and card grids elsewhere) plus a real, non-degenerate pixel
        // size avoids whatever heuristic was throttling it; `opacity: 0` +
        // `pointerEvents: none` + a negative `zIndex` keep it fully
        // invisible and inert either way.
        style={{ position: 'fixed', top: 0, left: 0, width: 256, height: 256, opacity: 0, pointerEvents: 'none', zIndex: -1 }}
      />
      <button
        type="button"
        onClick={handleClick}
        disabled={preparing}
        className={cn(
          'flex items-center justify-center gap-1.5 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-secondary/50 disabled:opacity-50',
          className,
        )}
      >
        {preparing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}
        {preparing ? t('arPreparing') : t('arActivateCamera')}
      </button>
    </>
  );
}
