import { NextRequest, NextResponse } from 'next/server';
import { REFRESH_COOKIE_NAME } from './lib/auth/cookie-names';

/**
 * Route segments that require an authenticated session. Mirrors the
 * app/(app)/ vs app/(public)/ split in Phase 2 §3.1 — everything under
 * these top-level paths sits behind the shell.
 */
const PROTECTED_SEGMENTS = [
  'dashboard',
  'catalog',
  'settings',
  'inventory',
  'bom',
  'production',
  'procurement',
  'sales',
  'hr',
  'reports',
  'ai',
  'notifications',
  'billing',
];

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Never intercept Next.js-owned API routes (auth cookie proxy, presign proxy).
  if (pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Locale is never part of the path (see i18n.ts) — no prefix to strip.
  const firstSegment = pathname.split('/').filter(Boolean)[0] ?? '';

  const hasRefreshToken = Boolean(request.cookies.get(REFRESH_COOKIE_NAME)?.value);

  // This is a presence check only — middleware cannot verify the opaque
  // refresh token's validity (that requires a DB round-trip owned by the
  // backend's auth_service). A stale/revoked cookie still gets past this
  // gate and is rejected on the first real API call, which then redirects
  // client-side via the 401 handler in lib/api-client/http.ts.
  if (PROTECTED_SEGMENTS.includes(firstSegment) && !hasRefreshToken) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (firstSegment === 'login' && hasRefreshToken) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next|.*\\..*).*)'],
};
