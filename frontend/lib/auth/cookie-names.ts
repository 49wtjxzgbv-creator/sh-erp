/**
 * Names of the httpOnly cookies set by our Next.js-owned auth route handlers
 * (app/api/auth/login|refresh|logout/route.ts). The backend itself never
 * sets cookies — auth.service.ts returns {accessToken, refreshToken,
 * expiresIn, userId, companyId} directly in the JSON body (confirmed by
 * reading the real source), so Next.js owns cookie storage per the Phase 2
 * §3.1 carve-out ("Next.js route handlers used only for things Next must
 * own, e.g. httpOnly-cookie auth proxying").
 *
 * The access token is intentionally NEVER put in a cookie — it lives only
 * in memory on the client (lib/auth/session-store.ts) for the lifetime of
 * the tab, per Phase 2 §5's short-lived-JWT-in-memory model.
 */
export const REFRESH_COOKIE_NAME = 'sh_refresh_token';
export const COMPANY_ID_COOKIE_NAME = 'sh_company_id';
export const USER_ID_COOKIE_NAME = 'sh_user_id';
/**
 * auth.service.ts's refresh() intentionally returns only {accessToken,
 * refreshToken, expiresIn} — no userId/companyId/companySlug (only login()
 * returns those). So the refresh route handler can't re-derive them from
 * the backend response; it re-reads them from these sibling httpOnly
 * cookies (set once at login, alongside the refresh token) instead.
 */
export const COMPANY_SLUG_COOKIE_NAME = 'sh_company_slug';
