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
 * sourcing-app's OWN photo viewer (2026-11-25) — forked from the shared
 * `components/ui/photo-lightbox.tsx` instead of modifying it in place, so
 * Mini-App-only behavior (Telegram safe-area clearance, upscaling a small
 * source photo to fill the screen) never leaks into the rest of the ERP,
 * which uses that shared component as-is. Keep this file's own fixes in
 * sync with the shared one's close-on-click mechanics if that ever
 * changes — same `document` capture-phase listener, same
 * `e.stopPropagation()` reasoning (closing unmounts the backdrop
 * synchronously mid-dispatch; on WebKit touch devices the same tap can
 * then fall through to whatever is newly exposed underneath).
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
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 z-10 rounded-full bg-black/60 p-3 text-white transition-colors hover:bg-black/80"
        // Clears Telegram's own floating close/menu buttons in fullscreen mode — see sourcing-app-shell.tsx's header for the same pattern.
        style={{ top: 'calc(1rem + env(safe-area-inset-top) + var(--tg-content-safe-area-top, 0px))' }}
        aria-label="Close"
      >
        <X className="h-7 w-7" />
      </button>
      {/* "є деякі маленького розміру... і їх майже не видно" — max-h/max-w alone only ever cap a SMALL source photo down to its own tiny intrinsic size; a real w/h box lets object-contain scale in BOTH directions. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL */}
      <img ref={imgRef} src={src} alt={alt} className="h-[90vh] w-[90vw] rounded-md object-contain shadow-2xl" />
    </div>,
    document.body,
  );
}
