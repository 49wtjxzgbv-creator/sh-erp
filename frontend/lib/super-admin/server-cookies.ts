import { NextResponse } from 'next/server';
import { SUPER_ADMIN_REFRESH_COOKIE_NAME } from './cookie-names';

/** Shared cookie-writing helpers for the three Next.js-owned super-admin auth route handlers. httpOnly — never read by client JS. */
const REFRESH_TTL_HOURS = Number(process.env.SUPER_ADMIN_REFRESH_TTL_HOURS ?? 12);

const baseCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: REFRESH_TTL_HOURS * 60 * 60,
};

export function setSuperAdminSessionCookie(response: NextResponse, refreshToken: string): void {
  response.cookies.set(SUPER_ADMIN_REFRESH_COOKIE_NAME, refreshToken, baseCookieOptions);
}

export function clearSuperAdminSessionCookie(response: NextResponse): void {
  response.cookies.set(SUPER_ADMIN_REFRESH_COOKIE_NAME, '', { ...baseCookieOptions, maxAge: 0 });
}
