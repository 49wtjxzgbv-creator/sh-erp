import { NextResponse } from 'next/server';
import {
  REFRESH_COOKIE_NAME,
  COMPANY_ID_COOKIE_NAME,
  USER_ID_COOKIE_NAME,
  COMPANY_SLUG_COOKIE_NAME,
} from './cookie-names';

/**
 * Shared cookie-writing helpers for the three Next.js-owned auth route
 * handlers (app/api/auth/login|refresh|logout/route.ts). All four cookies
 * are httpOnly — none of this is meant to be read by client JS, including
 * companyId/userId/companySlug, which only exist as cookies so the refresh
 * route can re-derive what auth.service.ts#refresh() doesn't return (see
 * the comment on COMPANY_SLUG_COOKIE_NAME in cookie-names.ts). The actual
 * client-readable copies of userId/companyId/companySlug live in the
 * Zustand session store, populated from the JSON body of these routes'
 * responses, not from the cookies themselves.
 */
const REFRESH_TTL_DAYS = Number(process.env.JWT_REFRESH_TTL_DAYS ?? 30);

const baseCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60,
};

export function setSessionCookies(
  response: NextResponse,
  session: { refreshToken: string; userId: string; companyId: string; companySlug: string },
): void {
  response.cookies.set(REFRESH_COOKIE_NAME, session.refreshToken, baseCookieOptions);
  response.cookies.set(USER_ID_COOKIE_NAME, session.userId, baseCookieOptions);
  response.cookies.set(COMPANY_ID_COOKIE_NAME, session.companyId, baseCookieOptions);
  response.cookies.set(COMPANY_SLUG_COOKIE_NAME, session.companySlug, baseCookieOptions);
}

export function clearSessionCookies(response: NextResponse): void {
  for (const name of [REFRESH_COOKIE_NAME, USER_ID_COOKIE_NAME, COMPANY_ID_COOKIE_NAME, COMPANY_SLUG_COOKIE_NAME]) {
    response.cookies.set(name, '', { ...baseCookieOptions, maxAge: 0 });
  }
}
