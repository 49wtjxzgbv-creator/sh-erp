'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export interface PhotoLightboxProps {
  src: string;
  alt?: string;
  onClose: () => void;
}

/**
 * Full-screen photo viewer — closes on Escape or a click anywhere outside
 * the photo itself. Rendered through a portal to `document.body` so it
 * always sits above whatever container it was triggered from (table cells,
 * cards, dialogs with their own z-index/overflow), the shared building
 * block behind `Avatar`'s `zoomable` prop and `EntityDocumentsField`'s
 * image preview.
 *
 * Close-on-click is wired as a raw `document` **capture-phase** listener
 * (mirroring the Escape handler right below it, and deliberately NOT
 * React's synthetic `onClick` on the backdrop/button). Root-caused live on
 * production (2026-08-13): some always-mounted Radix primitive elsewhere
 * on every page (the header's account/theme/language menus use Radix
 * DropdownMenu) installs its own `document`-level "click after a
 * pointerdown" bookkeeping listener for its own outside-click detection —
 * confirmed via a live trace that a *bubble*-phase click listener on
 * `document` reliably stopped arriving (event only ever reached
 * `eventPhase: CAPTURING_PHASE`, never `BUBBLING_PHASE`), while a
 * *capture*-phase listener on `document` always fires, since capture runs
 * top-down before any of that later bubble-phase interference can happen.
 * `imgRef.contains(e.target)` is the only thing gating it — not which
 * specific element (button vs. backdrop) was clicked — so this one
 * listener closes on both. The button keeps its own onClick too, but is
 * effectively redundant now: this capture-phase listener already fires
 * (and closes) before the click even reaches the button.
 *
 * `e.stopPropagation()` (2026-11-25 user report, sourcing-app on iPad:
 * tapping beside the photo closed the lightbox but the SAME tap also
 * landed on whatever was underneath, e.g. navigating a list item): closing
 * triggers a synchronous React unmount of the backdrop mid-dispatch: on
 * WebKit touch devices, the browser's hit-testing for that tap can then
 * resolve against whatever element is NOW exposed at that point instead of
 * the (just-removed) backdrop, letting the tap "fall through" to the page
 * behind. Stopping propagation the moment we decide to close keeps this
 * one event from being used for anything else, regardless of what the DOM
 * looks like a moment later.
 */
export function PhotoLightbox({ src, alt = '', onClose }: PhotoLightboxProps) {
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function onDocumentClick(e: MouseEvent) {
      if (imgRef.current && e.target instanceof Node && imgRef.current.contains(e.target)) return;
      e.stopPropagation();
      onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('click', onDocumentClick, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('click', onDocumentClick, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      // z-[100]: deliberately above the shared Dialog's z-50 (components/ui/dialog.tsx)
      // — this can be opened by clicking a photo inside an already-open Dialog
      // (e.g. a document/photo picker), and must never end up stacked
      // underneath that dialog's own overlay.
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        onClick={onClose}
        // Generous hit target (p-3, deliberately larger than a typical icon
        // button) — this is the one control on the whole screen with
        // nothing else to accidentally hit, so it should be impossible to
        // miss or misclick.
        className="absolute right-4 z-10 rounded-full bg-black/60 p-3 text-white transition-colors hover:bg-black/80"
        // `--tg-content-safe-area-top` (defaults to 0px everywhere outside
        // the sourcing-app Telegram Mini App) keeps this clear of
        // Telegram's own floating close/menu buttons in fullscreen mode —
        // same pattern as sourcing-app's other full-screen overlays
        // (model-3d-viewer, document-preview). A no-op on every other page
        // that renders this shared component.
        style={{ top: 'calc(1rem + env(safe-area-inset-top) + var(--tg-content-safe-area-top, 0px))' }}
        aria-label="Close"
      >
        <X className="h-7 w-7" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element -- same cross-origin presigned-URL reasoning as Avatar */}
      <img ref={imgRef} src={src} alt={alt} className="max-h-[90vh] max-w-[90vw] rounded-md object-contain shadow-2xl" />
    </div>,
    document.body,
  );
}
