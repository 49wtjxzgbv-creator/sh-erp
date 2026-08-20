import { NextRequest, NextResponse } from 'next/server';
import { setSessionCookies } from '@/lib/auth/server-cookies';

/**
 * P0 fix (2026-08-20): the old flow (app/impersonate/page.tsx, now deleted)
 * put the Super Admin panel's minted access token straight into the
 * regular app's in-memory session store and redirected — but never set the
 * httpOnly `sh_refresh_token` cookie, so middleware.ts immediately bounced
 * the new tab back to /login. This route closes that gap the same way
 * app/api/auth/login/route.ts does: proxy to the backend (here,
 * `POST super-admin/companies/:id/impersonate`, Bearer-authenticated with
 * the Super Admin's own access token, forwarded from the client), then
 * turn the returned refresh token into an httpOnly cookie via the exact
 * same `setSessionCookies` regular login uses — an impersonated session
 * IS a regular company session by design, just capped by a short,
 * non-extendable ceiling (see auth.service.ts#issueImpersonationSession).
 *
 * Called from app/super-admin/page.tsx's impersonate() handler, which
 * then opens a new tab at plain `/dashboard` (no query string) — that
 * tab's own SessionBoundary/restoreSession() does the rest, unmodified.
 */
const API_BASE = (process.env.INTERNAL_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1').replace(/\/$/, '');

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ statusCode: 401, message: 'Missing Super Admin authorization.' }, { status: 401 });
  }

  let body: { companyId?: string; userId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ statusCode: 400, message: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!body.companyId) {
    return NextResponse.json({ statusCode: 400, message: 'companyId is required.' }, { status: 400 });
  }

  const backendRes = await fetch(`${API_BASE}/super-admin/companies/${body.companyId}/impersonate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader },
    body: JSON.stringify(body.userId ? { userId: body.userId } : {}),
    cache: 'no-store',
  });

  const data = await backendRes.json().catch(() => undefined);

  if (!backendRes.ok) {
    return NextResponse.json(data ?? { statusCode: backendRes.status, message: 'Impersonation failed.' }, {
      status: backendRes.status,
    });
  }

  const { accessToken, refreshToken, companyId, companySlug, userId, impersonatedBy } = data as {
    accessToken: string;
    refreshToken: string;
    companyId: string;
    companySlug: string;
    userId: string;
    impersonatedBy?: string | null;
  };

  const response = NextResponse.json({ accessToken, userId, companyId, companySlug, impersonatedBy: impersonatedBy ?? null });
  setSessionCookies(response, { refreshToken, userId, companyId, companySlug });
  return response;
}
