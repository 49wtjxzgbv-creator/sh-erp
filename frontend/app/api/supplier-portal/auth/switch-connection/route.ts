import { NextRequest, NextResponse } from 'next/server';
import { setSupplierPortalSessionCookie, clearSupplierPortalSessionCookie } from '@/lib/supplier-portal/server-cookies';
import { SUPPLIER_PORTAL_REFRESH_COOKIE_NAME } from '@/lib/supplier-portal/cookie-names';

/**
 * Proxies to backend POST /api/v1/supplier-portal/auth/switch-connection
 * (2026-08-21 P0, ADR-0012 — multi-company redesign). Mirrors refresh/route.ts:
 * the raw refresh token never reaches the browser, only the httpOnly cookie
 * this route reads server-side; the client only supplies which connection
 * to switch to.
 */
const API_BASE = (process.env.INTERNAL_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1').replace(/\/$/, '');

export async function POST(request: NextRequest) {
  const refreshToken = request.cookies.get(SUPPLIER_PORTAL_REFRESH_COOKIE_NAME)?.value;

  if (!refreshToken) {
    const response = NextResponse.json({ statusCode: 401, message: 'No active supplier-portal session.' }, { status: 401 });
    clearSupplierPortalSessionCookie(response);
    return response;
  }

  let body: { connectionId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ statusCode: 400, message: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!body.connectionId) {
    return NextResponse.json({ statusCode: 400, message: 'connectionId is required.' }, { status: 400 });
  }

  const backendRes = await fetch(`${API_BASE}/supplier-portal/auth/switch-connection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken, connectionId: body.connectionId }),
    cache: 'no-store',
  });

  const data = await backendRes.json().catch(() => undefined);

  if (!backendRes.ok) {
    // Deliberately does NOT clear the cookie here — a rejected switch (e.g.
    // target connection revoked/not-yours) must not sign the caller out of
    // their still-valid current session (see SupplierPortalRefreshTokenService#peek).
    return NextResponse.json(data ?? { statusCode: backendRes.status, message: 'Switch failed.' }, {
      status: backendRes.status,
    });
  }

  const { accessToken, refreshToken: newRefreshToken, expiresIn, supplierId, companyId, companyName, activeConnectionId, email } = data as {
    accessToken: string;
    refreshToken: string;
    expiresIn: string;
    supplierId: string | null;
    companyId: string | null;
    companyName: string | null;
    activeConnectionId: string | null;
    email: string;
  };

  const response = NextResponse.json({ accessToken, expiresIn, email, supplierId, companyId, companyName, activeConnectionId });
  setSupplierPortalSessionCookie(response, newRefreshToken);
  return response;
}
