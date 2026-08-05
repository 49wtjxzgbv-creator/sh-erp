/**
 * @jest-environment node
 *
 * next/server's NextResponse needs the Fetch API globals (Request/Response),
 * which Node provides natively but jsdom (this project's default test
 * environment, set for everything else so React Testing Library works)
 * does not. Route-handler-adjacent code is tested under 'node' per-file.
 */
import { NextResponse } from 'next/server';
import { setSessionCookies, clearSessionCookies } from './server-cookies';
import {
  REFRESH_COOKIE_NAME,
  USER_ID_COOKIE_NAME,
  COMPANY_ID_COOKIE_NAME,
  COMPANY_SLUG_COOKIE_NAME,
} from './cookie-names';

describe('setSessionCookies', () => {
  it('sets all four cookies as httpOnly with the session values', () => {
    const res = NextResponse.json({ ok: true });
    setSessionCookies(res, {
      refreshToken: 'refresh-abc',
      userId: 'u1',
      companyId: 'c1',
      companySlug: 'shyring',
    });

    expect(res.cookies.get(REFRESH_COOKIE_NAME)?.value).toBe('refresh-abc');
    expect(res.cookies.get(USER_ID_COOKIE_NAME)?.value).toBe('u1');
    expect(res.cookies.get(COMPANY_ID_COOKIE_NAME)?.value).toBe('c1');
    expect(res.cookies.get(COMPANY_SLUG_COOKIE_NAME)?.value).toBe('shyring');
    expect(res.cookies.get(REFRESH_COOKIE_NAME)?.httpOnly).toBe(true);
  });
});

describe('clearSessionCookies', () => {
  it('zeroes out maxAge on all four cookies', () => {
    const res = NextResponse.json({ ok: true });
    clearSessionCookies(res);

    for (const name of [REFRESH_COOKIE_NAME, USER_ID_COOKIE_NAME, COMPANY_ID_COOKIE_NAME, COMPANY_SLUG_COOKIE_NAME]) {
      expect(res.cookies.get(name)?.value).toBe('');
      expect(res.cookies.get(name)?.maxAge).toBe(0);
    }
  });
});
