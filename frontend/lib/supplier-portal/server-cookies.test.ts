/**
 * @jest-environment node
 *
 * next/server's NextResponse needs the Fetch API globals (Request/Response),
 * which Node provides natively but jsdom does not — see
 * lib/auth/server-cookies.test.ts's identical header comment.
 */
import { NextResponse } from 'next/server';
import { setSupplierPortalSessionCookie, clearSupplierPortalSessionCookie } from './server-cookies';
import { SUPPLIER_PORTAL_REFRESH_COOKIE_NAME } from './cookie-names';

describe('setSupplierPortalSessionCookie', () => {
  it('sets the refresh cookie as httpOnly with the token value', () => {
    const res = NextResponse.json({ ok: true });
    setSupplierPortalSessionCookie(res, 'refresh-abc');

    expect(res.cookies.get(SUPPLIER_PORTAL_REFRESH_COOKIE_NAME)?.value).toBe('refresh-abc');
    expect(res.cookies.get(SUPPLIER_PORTAL_REFRESH_COOKIE_NAME)?.httpOnly).toBe(true);
  });
});

describe('clearSupplierPortalSessionCookie', () => {
  it('zeroes out maxAge on the refresh cookie', () => {
    const res = NextResponse.json({ ok: true });
    clearSupplierPortalSessionCookie(res);

    expect(res.cookies.get(SUPPLIER_PORTAL_REFRESH_COOKIE_NAME)?.value).toBe('');
    expect(res.cookies.get(SUPPLIER_PORTAL_REFRESH_COOKIE_NAME)?.maxAge).toBe(0);
  });
});
