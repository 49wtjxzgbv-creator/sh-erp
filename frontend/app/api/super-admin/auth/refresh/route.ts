import { NextRequest, NextResponse } from 'next/server';
import { setSuperAdminSessionCookie, clearSuperAdminSessionCookie } from '@/lib/super-admin/server-cookies';
import { SUPER_ADMIN_REFRESH_COOKIE_NAME } from '@/lib/super-admin/cookie-names';

/**
 * Proxies to backend POST /api/v1/super-admin/auth/refresh. Called on
 * super-admin shell mount (lib/super-admin/actions.ts#restoreSession) to
 * silently re-derive an access token from the httpOnly cookie after a
 * reload/new tab — the actual fix for "reload logs the Super Admin out"
 * (P0 fix, 2026-08-20). Also used by lib/super-admin/api.ts's 401-retry.
 *
 * Unlike the regular-auth refresh route, no companion identity cookies are
 * needed: `SuperAdminAuthService#refresh` returns `email`/`permissions`
 * directly in its JSON body.
 */
const API_BASE = (process.env.INTERNAL_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1').replace(/\/$/, '');

export async function POST(request: NextRequest) {
  const refreshToken = request.cookies.get(SUPER_ADMIN_REFRESH_COOKIE_NAME)?.value;

  if (!refreshToken) {
    const response = NextResponse.json({ statusCode: 401, message: 'No active super-admin session.' }, { status: 401 });
    clearSuperAdminSessionCookie(response);
    return response;
  }

  const backendRes = await fetch(`${API_BASE}/super-admin/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
    cache: 'no-store',
  });

  const data = await backendRes.json().catch(() => undefined);

  if (!backendRes.ok) {
    const response = NextResponse.json(data ?? { statusCode: backendRes.status, message: 'Refresh failed.' }, {
      status: backendRes.status,
    });
    clearSuperAdminSessionCookie(response);
    return response;
  }

  const { accessToken, refreshToken: newRefreshToken, expiresIn, permissions, email } = data as {
    accessToken: string;
    refreshToken: string;
    expiresIn: string;
    permissions: string[];
    email: string;
  };

  const response = NextResponse.json({ accessToken, expiresIn, email, permissions });
  setSuperAdminSessionCookie(response, newRefreshToken);
  return response;
}
