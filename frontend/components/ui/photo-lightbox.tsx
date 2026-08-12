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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70"
        aria-label="Close"
      >
        <X className="h-6 w-6" />
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
