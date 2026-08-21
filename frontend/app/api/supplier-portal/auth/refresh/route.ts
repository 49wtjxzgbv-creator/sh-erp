import { NextRequest, NextResponse } from 'next/server';
import { setSupplierPortalSessionCookie, clearSupplierPortalSessionCookie } from '@/lib/supplier-portal/server-cookies';
import { SUPPLIER_PORTAL_REFRESH_COOKIE_NAME } from '@/lib/supplier-portal/cookie-names';

/**
 * Proxies to backend POST /api/v1/supplier-portal/auth/refresh. Called on
 * supplier-portal shell mount (lib/supplier-portal/actions.ts#restoreSession)
 * to silently re-derive an access token from the httpOnly cookie after a
 * reload/new tab, and by lib/supplier-portal/api.ts's 401-retry.
 */
const API_BASE = (process.env.INTERNAL_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1').replace(/\/$/, '');

export async function POST(request: NextRequest) {
  const refreshToken = request.cookies.get(SUPPLIER_PORTAL_REFRESH_COOKIE_NAME)?.value;

  if (!refreshToken) {
    const response = NextResponse.json({ statusCode: 401, message: 'No active supplier-portal session.' }, { status: 401 });
    clearSupplierPortalSessionCookie(response);
    return response;
  }

  const backendRes = await fetch(`${API_BASE}/supplier-portal/auth/refresh`, {
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
    clearSupplierPortalSessionCookie(response);
    return response;
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
