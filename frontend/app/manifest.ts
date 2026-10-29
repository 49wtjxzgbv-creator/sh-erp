import type { MetadataRoute } from 'next';

/**
 * Next.js App Router file convention — auto-generates /manifest.webmanifest
 * and injects the <link rel="manifest"> tag, no manual wiring in layout.tsx
 * needed. Icons are pre-rasterized PNGs derived from the master SVG
 * (public/brand/logo.svg) — see public/icons/.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SH ERP',
    short_name: 'SH ERP',
    description: 'SH ERP — виробничий та складський облік для реального бізнесу',
    start_url: '/',
    display: 'standalone',
    background_color: '#0c0c0f',
    theme_color: '#400C9A',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    // "воно відкриває в новому вікні типу як в додатку" (2026-10-29) — on a
    // machine with SH ERP installed as a desktop/PWA app, Chrome's Link
    // Capturing routes a same-origin `window.open(...)` (every "Переглянути"
    // preview button, PreviewButton in print-area.tsx) into the chromeless
    // installed-app window instead of a normal browser tab. Next.js's own
    // `MetadataRoute.Manifest` type doesn't model this (newer) field —
    // `as const` + the outer function's declared return type still checks
    // every OTHER key, this one just isn't typed yet.
    capture_links: 'none',
  } as MetadataRoute.Manifest & { capture_links: 'none' };
}
