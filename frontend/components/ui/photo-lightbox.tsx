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
 * Close-on-click is wired as a raw `document` listener (mirroring the
 * Escape handler right below it), not React's synthetic `onClick` on the
 * backdrop/button — reported unreliable in some environments (click did
 * nothing, only Escape worked) despite the synthetic handlers being
 * present and correctly wired; a native listener checked against
 * `imgRef.contains(e.target)` is a strictly more robust mechanism since it
 * doesn't depend on which exact element the click lands on, only on
 * whether it's the photo itself. The button keeps its own onClick too —
 * redundant with the document listener, but harmless (onClose is
 * idempotent) and keeps the button self-contained/testable on its own.
 */
export function PhotoLightbox({ src, alt = '', onClose }: PhotoLightboxProps) {
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function onDocumentClick(e: MouseEvent) {
      if (imgRef.current && e.target instanceof Node && imgRef.current.contains(e.target)) return;
      onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('click', onDocumentClick);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('click', onDocumentClick);
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
        className="absolute right-4 top-4 z-10 rounded-full bg-black/60 p-3 text-white transition-colors hover:bg-black/80"
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
