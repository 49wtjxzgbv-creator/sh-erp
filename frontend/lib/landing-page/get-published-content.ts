import type { PublicLandingPageResponse } from './types';

// Same env-var convention as app/api/auth/*/route.ts (INTERNAL_API_BASE_URL,
// falling back to the public one) — this is that pattern's first reuse
// outside the Next-owned auth routes.
const API_BASE = (process.env.INTERNAL_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1').replace(/\/$/, '');

/**
 * Server-only fetch of the public homepage's PUBLISHED content. Deliberately
 * `next: { revalidate: 60 }` (ISR-style), not this app's usual `no-store` —
 * the rest of the app is all-dynamic/authenticated so far, but this is the
 * first genuinely public, cacheable, SEO-relevant page, so a 60s revalidate
 * window is a deliberate, justified deviation from that convention, not an
 * oversight.
 */
export async function getPublishedLandingPage(): Promise<PublicLandingPageResponse> {
  const res = await fetch(`${API_BASE}/landing-page`, { next: { revalidate: 60 } });
  if (!res.ok) {
    throw new Error(`GET /landing-page failed: ${res.status}`);
  }
  return res.json();
}
