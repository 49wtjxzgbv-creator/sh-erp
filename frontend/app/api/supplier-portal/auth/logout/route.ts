import { NextRequest, NextResponse } from 'next/server';
import { clearSupplierPortalSessionCookie } from '@/lib/supplier-portal/server-cookies';
import { SUPPLIER_PORTAL_REFRESH_COOKIE_NAME } from '@/lib/supplier-portal/cookie-names';

/**
 * Proxies to backend POST /api/v1/supplier-portal/auth/logout, which
 * revokes the refresh token's entire rotation family. Clears the cookie
 * regardless of whether the backend call succeeds.
 */
const API_BASE = (process.env.INTERNAL_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1').replace(/\/$/, '');

export async function POST(request: NextRequest) {
  const refreshToken = request.cookies.get(SUPPLIER_PORTAL_REFRESH_COOKIE_NAME)?.value;

  if (refreshToken) {
    await fetch(`${API_BASE}/supplier-portal/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    }).catch(() => {
      // Best-effort — cookie is cleared below regardless.
    });
  }

  const response = NextResponse.json({ ok: true });
  clearSupplierPortalSessionCookie(response);
  return response;
}
