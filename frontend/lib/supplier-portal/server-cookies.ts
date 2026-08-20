import { NextResponse } from 'next/server';
import { SUPPLIER_PORTAL_REFRESH_COOKIE_NAME } from './cookie-names';

/** Shared cookie-writing helpers for the three Next.js-owned supplier-portal auth route handlers. httpOnly — never read by client JS. */
const REFRESH_TTL_DAYS = Number(process.env.SUPPLIER_PORTAL_REFRESH_TTL_DAYS ?? 30);

const baseCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60,
};

export function setSupplierPortalSessionCookie(response: NextResponse, refreshToken: string): void {
  response.cookies.set(SUPPLIER_PORTAL_REFRESH_COOKIE_NAME, refreshToken, baseCookieOptions);
}

export function clearSupplierPortalSessionCookie(response: NextResponse): void {
  response.cookies.set(SUPPLIER_PORTAL_REFRESH_COOKIE_NAME, '', { ...baseCookieOptions, maxAge: 0 });
}
