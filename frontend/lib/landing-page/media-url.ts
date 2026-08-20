// Deliberately NEXT_PUBLIC_API_BASE_URL only, never INTERNAL_API_BASE_URL —
// this URL gets embedded in server-rendered HTML and fetched by the
// browser directly (an <img>/<Image> src, not a server-to-server call), so
// it must always be the real public URL, unlike the Next-owned auth
// routes' server-to-server proxy calls.
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1').replace(/\/$/, '');

/**
 * Public marketing images are served through this backend's own streaming
 * proxy (GET /landing-page/media/:id — see landing-page-public.service.ts's
 * own comment for why: no R2 public domain to provision, no Cloudflare
 * dashboard access needed). A missing imageId means "no image", not an
 * error — every caller already handles `null` gracefully.
 */
export function landingMediaUrl(imageId: string | null | undefined): string | null {
  if (!imageId) return null;
  return `${API_BASE}/landing-page/media/${imageId}`;
}
