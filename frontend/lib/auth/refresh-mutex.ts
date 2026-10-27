'use client';

export interface RefreshResult {
  ok: boolean;
  status: number;
  body: unknown;
}

const inFlight = new Map<string, Promise<RefreshResult>>();

/**
 * "чому часто виходить з акаунту на вхід" (2026-10-27): serializes
 * `POST .../auth/refresh` calls for one `key` (one auth domain — main
 * app, super-admin, supplier-portal each have their own httpOnly refresh
 * cookie) so concurrent 401s/tab-mounts never submit the SAME not-yet-
 * rotated refresh-token value twice. The backend's reuse-detection
 * (ADR-0006, auth.service.ts#refresh) treats a second submission of an
 * already-rotated token as theft and revokes the WHOLE token family —
 * exactly what an unprotected concurrent refresh used to trigger whenever
 * several tabs (or several in-tab requests) all hit a 401 around the same
 * 15-minute access-token expiry.
 *
 * Two layers: 1) an in-tab in-flight-promise cache (dedupes same-tab
 * races — several TanStack Query hooks all 401ing at once), 2) the Web
 * Locks API (dedupes ACROSS this browser's other open tabs sharing the
 * same cookie). Since the httpOnly cookie always reflects its CURRENT
 * value at fetch time (never a JS-cached one), serializing is sufficient
 * on its own — a request that waited its turn simply rotates whatever the
 * cookie currently is, rather than racing a stale value. Falls back to a
 * bare fetch when Web Locks isn't available (older Safari) — same-tab
 * dedup alone still closes the most common case.
 *
 * Returns a plain parsed-body result rather than the raw `Response` —
 * several callers can share the exact same in-flight promise, and a
 * `Response`'s body can only ever be read once, so the body is consumed
 * and parsed exactly here, a single time, regardless of how many callers
 * are awaiting this same refresh.
 */
export async function serializedRefresh(key: string, url: string): Promise<RefreshResult> {
  const existing = inFlight.get(key);
  if (existing) return existing;

  const doFetch = async (): Promise<RefreshResult> => {
    const res = await fetch(url, { method: 'POST', credentials: 'include' });
    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text ? JSON.parse(text) : undefined };
  };

  const promise = (typeof navigator !== 'undefined' && 'locks' in navigator
    ? (navigator as unknown as { locks: { request: (name: string, cb: () => Promise<RefreshResult>) => Promise<RefreshResult> } }).locks.request(
        key,
        doFetch,
      )
    : doFetch()
  ).finally(() => inFlight.delete(key));

  inFlight.set(key, promise);
  return promise;
}
