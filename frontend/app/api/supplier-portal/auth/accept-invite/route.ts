import { NextRequest, NextResponse } from 'next/server';
import { setSupplierPortalSessionCookie } from '@/lib/supplier-portal/server-cookies';

/**
 * Proxies to backend POST /api/v1/supplier-portal/auth/invite/:token/accept
 * (2026-08-21 P1, ADR-0013 — self-service registration). Mirrors
 * login/route.ts: success mints a session, so only this same-origin route
 * can turn the returned refresh token into an httpOnly cookie.
 */
const API_BASE = (process.env.INTERNAL_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1').replace(/\/$/, '');

export async function POST(request: NextRequest) {
  let body: { token?: string; email?: string; password?: string; organizationName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ statusCode: 400, message: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!body.token) {
    return NextResponse.json({ statusCode: 400, message: 'token is required.' }, { status: 400 });
  }
  const { token, ...dto } = body;

  const backendRes = await fetch(`${API_BASE}/supplier-portal/auth/invite/${encodeURIComponent(token)}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dto),
    cache: 'no-store',
  });

  const data = await backendRes.json().catch(() => undefined);

  if (!backendRes.ok) {
    return NextResponse.json(data ?? { statusCode: backendRes.status, message: 'Registration failed.' }, {
      status: backendRes.status,
    });
  }

  const { accessToken, refreshToken, expiresIn, supplierId, companyId, companyName, activeConnectionId, email } = data as {
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
  setSupplierPortalSessionCookie(response, refreshToken);
  return response;
}
