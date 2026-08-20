/**
 * @jest-environment node
 *
 * next/server's NextResponse needs the Fetch API globals (Request/Response),
 * which Node provides natively but jsdom does not — see
 * lib/auth/server-cookies.test.ts's identical header comment.
 */
import { NextResponse } from 'next/server';
import { setSuperAdminSessionCookie, clearSuperAdminSessionCookie } from './server-cookies';
import { SUPER_ADMIN_REFRESH_COOKIE_NAME } from './cookie-names';

describe('setSuperAdminSessionCookie', () => {
  it('sets the refresh cookie as httpOnly with the token value', () => {
    const res = NextResponse.json({ ok: true });
    setSuperAdminSessionCookie(res, 'refresh-abc');

    expect(res.cookies.get(SUPER_ADMIN_REFRESH_COOKIE_NAME)?.value).toBe('refresh-abc');
    expect(res.cookies.get(SUPER_ADMIN_REFRESH_COOKIE_NAME)?.httpOnly).toBe(true);
  });
});

describe('clearSuperAdminSessionCookie', () => {
  it('zeroes out maxAge on the refresh cookie', () => {
    const res = NextResponse.json({ ok: true });
    clearSuperAdminSessionCookie(res);

    expect(res.cookies.get(SUPER_ADMIN_REFRESH_COOKIE_NAME)?.value).toBe('');
    expect(res.cookies.get(SUPER_ADMIN_REFRESH_COOKIE_NAME)?.maxAge).toBe(0);
  });
});
