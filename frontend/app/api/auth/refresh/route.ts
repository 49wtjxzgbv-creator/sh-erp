import { NextRequest, NextResponse } from 'next/server';
import { setSessionCookies, clearSessionCookies } from '@/lib/auth/server-cookies';
import {
  REFRESH_COOKIE_NAME,
  USER_ID_COOKIE_NAME,
  COMPANY_ID_COOKIE_NAME,
  COMPANY_SLUG_COOKIE_NAME,
} from '@/lib/auth/cookie-names';

/**
 * Proxies to backend POST /api/v1/auth/refresh. Called two ways: on app
 * load (lib/auth/actions.ts#restoreSession, to silently re-derive an
 * access token from the httpOnly cookie after a page refresh/new tab) and
 * from lib/api-client/http.ts's 401-retry interceptor.
 *
 * auth.service.ts#refresh() returns only {accessToken, refreshToken,
 * expiresIn} — no identity fields — so userId/companyId/companySlug are
 * read back from the sibling cookies set at login (see cookie-names.ts).
 */
const API_BASE = (process.env.INTERNAL_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1').replace(/\/$/, '');

export async function POST(request: NextRequest) {
  const refreshToken = request.cookies.get(REFRESH_COOKIE_NAME)?.value;
  const userId = request.cookies.get(USER_ID_COOKIE_NAME)?.value;
  const companyId = request.cookies.get(COMPANY_ID_COOKIE_NAME)?.value;
  const companySlug = request.cookies.get(COMPANY_SLUG_COOKIE_NAME)?.value;

  if (!refreshToken || !userId || !companyId) {
    const response = NextResponse.json({ statusCode: 401, message: 'No active session.' }, { status: 401 });
    clearSessionCookies(response);
    return response;
  }

  const backendRes = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
    cache: 'no-store',
  });

  const data = await backendRes.json().catch(() => undefined);

  if (!backendRes.ok) {
    // Expired, revoked, or reused-and-family-revoked (auth.service.ts's
    // reuse-detection) — either way, the session is gone, so drop cookies
    // rather than leaving a dead refresh token sitting in the browser.
    const response = NextResponse.json(data ?? { statusCode: backendRes.status, message: 'Refresh failed.' }, {
      status: backendRes.status,
    });
    clearSessionCookies(response);
    return response;
  }

  const { accessToken, refreshToken: newRefreshToken } = data as { accessToken: string; refreshToken: string };

  const response = NextResponse.json({ accessToken, userId, companyId, companySlug: companySlug ?? '' });
  setSessionCookies(response, { refreshToken: newRefreshToken, userId, companyId, companySlug: companySlug ?? '' });
  return response;
}
