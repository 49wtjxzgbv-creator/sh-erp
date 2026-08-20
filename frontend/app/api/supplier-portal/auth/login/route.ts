import { NextRequest, NextResponse } from 'next/server';
import { setSupplierPortalSessionCookie } from '@/lib/supplier-portal/server-cookies';

/**
 * Proxies to backend POST /api/v1/supplier-portal/auth/login. P0 fix
 * (2026-08-20): login previously called the backend directly from the
 * browser (supplierPortalApi), which can't set an httpOnly cookie. Now
 * goes through this same-origin route (mirrors app/api/auth/login/route.ts),
 * which turns the returned refresh token into an httpOnly cookie.
 */
const API_BASE = (process.env.INTERNAL_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1').replace(/\/$/, '');

export async function POST(request: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ statusCode: 400, message: 'Invalid JSON body.' }, { status: 400 });
  }

  const backendRes = await fetch(`${API_BASE}/supplier-portal/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  const data = await backendRes.json().catch(() => undefined);

  if (!backendRes.ok) {
    return NextResponse.json(data ?? { statusCode: backendRes.status, message: 'Login failed.' }, {
      status: backendRes.status,
    });
  }

  const { accessToken, refreshToken, expiresIn, supplierId, companyId, email } = data as {
    accessToken: string;
    refreshToken: string;
    expiresIn: string;
    supplierId: string;
    companyId: string;
    email: string;
  };

  const response = NextResponse.json({ accessToken, expiresIn, email, supplierId, companyId });
  setSupplierPortalSessionCookie(response, refreshToken);
  return response;
}
