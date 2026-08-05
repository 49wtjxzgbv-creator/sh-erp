import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookies } from '@/lib/auth/server-cookies';
import { REFRESH_COOKIE_NAME } from '@/lib/auth/cookie-names';

/**
 * Proxies to backend POST /api/v1/auth/logout, which revokes the refresh
 * token's entire rotation family (auth.service.ts#revokeFamily — signs out
 * every tab/device that shared this session, per ADR-0006). Idempotent on
 * the backend side, so we clear cookies regardless of whether the backend
 * call succeeds (e.g. token already expired) — the point of "logout" is
 * that this browser stops being able to authenticate.
 */
const API_BASE = (process.env.INTERNAL_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1').replace(/\/$/, '');

export async function POST(request: NextRequest) {
  const refreshToken = request.cookies.get(REFRESH_COOKIE_NAME)?.value;

  if (refreshToken) {
    await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    }).catch(() => {
      // Best-effort — cookies are cleared below regardless.
    });
  }

  const response = NextResponse.json({ ok: true });
  clearSessionCookies(response);
  return response;
}
