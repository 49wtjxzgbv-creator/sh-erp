/**
 * Name of the single httpOnly cookie set by our Next.js-owned
 * supplier-portal auth route handlers
 * (app/api/supplier-portal/auth/login|refresh|logout/route.ts). Distinct
 * from both the regular app's and Super Admin's cookies — a browser could
 * plausibly hold sessions on all three surfaces at once.
 *
 * Only one cookie needed: `SupplierPortalAuthService#refresh` returns
 * `supplierId`/`companyId` directly in its JSON body, so there's no
 * missing identity data that needs a companion cookie to re-derive.
 */
export const SUPPLIER_PORTAL_REFRESH_COOKIE_NAME = 'sh_supplier_portal_refresh_token';
