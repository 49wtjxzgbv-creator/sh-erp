import type { NextRequest } from 'next/server';

/**
 * Forwards the REAL browser's IP/User-Agent through this server-to-server
 * proxy hop to the backend (2026-09-17 real bug found live — Super Admin's
 * new login-sessions view showed "не визначено"/"—" for every fresh login).
 * `app/api/auth/{login,refresh,impersonate}/route.ts` call the backend
 * directly, server-to-server (`INTERNAL_API_BASE_URL`) — without this, the
 * backend's own `getClientMeta(req)` legitimately sees ITS caller, the
 * Next.js server itself, not the actual end user's browser. Nginx already
 * sets `X-Forwarded-For` correctly for the Browser -> Nginx -> Next.js hop
 * (see ops/nginx/app.conf.template) — this just re-forwards that same
 * value (and the original User-Agent) on the SECOND hop, Next.js ->
 * backend, which Express's own `trust proxy` (backend/src/main.ts) then
 * reads back out via `req.ip`. In local dev (no Nginx in front), there is
 * no `x-forwarded-for` header to forward — this silently omits it rather
 * than fabricating one, same as before this fix, no regression there.
 */
export function forwardClientMetaHeaders(request: NextRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) headers['X-Forwarded-For'] = forwardedFor;
  const userAgent = request.headers.get('user-agent');
  if (userAgent) headers['User-Agent'] = userAgent;
  return headers;
}
