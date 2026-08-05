import { AsyncLocalStorage } from 'node:async_hooks';

// Per Phase 2 §11.4 / ADR-0002: the JWT's `companyId` claim is the ONLY
// trusted source of tenant scope for a request — never a URL param, header,
// or subdomain (those are UX-only, re-validated after auth). TenantContextMiddleware
// (see ../common/middleware/tenant-context.middleware.ts) populates this
// store once per request, immediately after the JWT is verified; the Prisma
// Client Extension in prisma-tenant.extension.ts reads it on every query.
export interface TenantContext {
  companyId: string;
  userId: string;
}

export const tenantContextStorage = new AsyncLocalStorage<TenantContext>();

export function getTenantContext(): TenantContext {
  const ctx = tenantContextStorage.getStore();
  if (!ctx) {
    // Fails loudly rather than silently querying unscoped — a missing
    // tenant context is always a bug (a route that forgot the auth guard,
    // or a background job that forgot to open its own scope), never a
    // legitimate "no tenant" case for anything in the tenant-scoped domain.
    throw new Error(
      'No tenant context available. Every tenant-scoped Prisma query must run inside ' +
        'tenantContextStorage.run(...) — see TenantContextMiddleware or, for background ' +
        'jobs, the per-job context wrapper in the worker process.',
    );
  }
  return ctx;
}
