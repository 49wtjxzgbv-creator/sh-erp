/**
 * Name of the single httpOnly cookie set by our Next.js-owned super-admin
 * auth route handlers (app/api/super-admin/auth/login|refresh|logout/route.ts).
 * Deliberately its own cookie, distinct from the regular app's
 * `sh_refresh_token` (lib/auth/cookie-names.ts) — a browser could plausibly
 * hold a regular company session and a Super Admin session at once, and
 * they must never collide or be confused with one another.
 *
 * Only one cookie needed here (unlike the regular app's four): unlike
 * `AuthService#refresh`, `SuperAdminAuthService#refresh` returns `email`
 * and `permissions` directly in its JSON body, so there's no missing
 * identity data that needs a companion cookie to re-derive.
 */
export const SUPER_ADMIN_REFRESH_COOKIE_NAME = 'sh_super_admin_refresh_token';
