'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export interface PhotoLightboxProps {
  src: string;
  alt?: string;
  onClose: () => void;
}

/**
 * Full-screen photo viewer — closes on Escape or a click on the backdrop.
 * Rendered through a portal to `document.body` so it always sits above
 * whatever container it was triggered from (table cells, cards, dialogs
 * with their own z-index/overflow), the shared building block behind
 * `Avatar`'s `zoomable` prop and `EntityDocumentsField`'s image preview.
 */
export function PhotoLightbox({ src, alt = '', onClose }: PhotoLightboxProps) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      // z-[100]: deliberately above the shared Dialog's z-50 (components/ui/dialog.tsx)
      // — this can be opened by clicking a photo inside an already-open Dialog
      // (e.g. a document/photo picker), and must never end up stacked
      // underneath that dialog's own overlay.
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
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
      <img
        src={src}
        alt={alt}
        className="max-h-[90vh] max-w-[90vw] rounded-md object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body,
  );
}
