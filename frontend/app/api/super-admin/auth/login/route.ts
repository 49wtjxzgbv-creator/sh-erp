import { NextRequest, NextResponse } from 'next/server';
import { setSuperAdminSessionCookie } from '@/lib/super-admin/server-cookies';

/**
 * Proxies to backend POST /api/v1/super-admin/auth/login. P0 fix
 * (2026-08-20): login previously called the backend directly from the
 * browser (superAdminApi), which can't set an httpOnly cookie — so there
 * was nothing for a reload to restore a session from. Login now goes
 * through this same-origin route instead (mirrors app/api/auth/login/route.ts),
 * which turns the returned refresh token into an httpOnly cookie and
 * returns only the access token + identity/permissions to the client.
 */
const API_BASE = (process.env.INTERNAL_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1').replace(/\/$/, '');

export async function POST(request: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ statusCode: 400, message: 'Invalid JSON body.' }, { status: 400 });
  }

  const backendRes = await fetch(`${API_BASE}/super-admin/auth/login`, {
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

  const { accessToken, refreshToken, expiresIn, permissions } = data as {
    accessToken: string;
    refreshToken: string;
    expiresIn: string;
    permissions: string[];
  };

  const response = NextResponse.json({ accessToken, expiresIn, email: body.email, permissions });
  setSuperAdminSessionCookie(response, refreshToken);
  return response;
}
