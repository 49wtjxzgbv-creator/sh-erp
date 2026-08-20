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
  };
}
