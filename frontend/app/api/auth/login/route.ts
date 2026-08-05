import { NextRequest, NextResponse } from 'next/server';
import { setSessionCookies } from '@/lib/auth/server-cookies';

/**
 * Proxies to backend POST /api/v1/auth/login (backend/src/modules/identity/auth.controller.ts).
 * Request body is passed through unchanged: {email, password, companySlug}
 * (backend/src/modules/identity/dto/login.dto.ts).
 *
 * The backend returns {accessToken, refreshToken, expiresIn, userId,
 * companyId} directly in its JSON body — it never sets a cookie itself.
 * This route is what turns that into: an httpOnly refresh cookie (never
 * touched by client JS) plus a JSON response containing only the
 * short-lived access token and identity fields, for the client to hold in
 * memory (lib/auth/session-store.ts).
 */
const API_BASE = (process.env.INTERNAL_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1').replace(/\/$/, '');

export async function POST(request: NextRequest) {
  let body: { companySlug?: string; email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ statusCode: 400, message: 'Invalid JSON body.' }, { status: 400 });
  }

  const backendRes = await fetch(`${API_BASE}/auth/login`, {
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

  const { accessToken, refreshToken, userId, companyId } = data as {
    accessToken: string;
    refreshToken: string;
    userId: string;
    companyId: string;
  };

  const response = NextResponse.json({ accessToken, userId, companyId, companySlug: body.companySlug });
  setSessionCookies(response, { refreshToken, userId, companyId, companySlug: body.companySlug ?? '' });
  return response;
}
