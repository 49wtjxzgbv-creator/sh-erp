import { NextRequest, NextResponse } from 'next/server';
import { clearSuperAdminSessionCookie } from '@/lib/super-admin/server-cookies';
import { SUPER_ADMIN_REFRESH_COOKIE_NAME } from '@/lib/super-admin/cookie-names';

/**
 * Proxies to backend POST /api/v1/super-admin/auth/logout, which revokes
 * the refresh token's entire rotation family. Clears the cookie regardless
 * of whether the backend call succeeds — the point of "logout" is that
 * this browser stops being able to authenticate.
 */
const API_BASE = (process.env.INTERNAL_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1').replace(/\/$/, '');

export async function POST(request: NextRequest) {
  const refreshToken = request.cookies.get(SUPER_ADMIN_REFRESH_COOKIE_NAME)?.value;

  if (refreshToken) {
    await fetch(`${API_BASE}/super-admin/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    }).catch(() => {
      // Best-effort — cookie is cleared below regardless.
    });
  }

  const response = NextResponse.json({ ok: true });
  clearSuperAdminSessionCookie(response);
  return response;
}
