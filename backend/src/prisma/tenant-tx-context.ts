import { AsyncLocalStorage } from 'node:async_hooks';
import type { TenantPrismaClient } from './prisma.service';

/**
 * Holds the per-request, RLS-activated, tenant-scoped Prisma client for the
 * duration of a request — populated once by TenantScopeInterceptor (see
 * ../common/interceptors/tenant-scope.interceptor.ts), read by
 * PrismaService.tenant.
 *
 * Why this exists (a real gap found and fixed during Module 4 work, not a
 * change to the Phase 2/3 architecture — see the interceptor's own header
 * comment for the full explanation): `PrismaService.tenant` originally
 * returned a fresh `this.$extends(tenantScopingExtension())` on every
 * access. That correctly auto-injects/validates `companyId` at the
 * application layer, but never issued the `SET LOCAL app.current_company_id`
 * that Postgres RLS (database-schema.md §2) requires — meaning every write
 * in Modules 1-3 would have been silently rejected by RLS (or returned
 * nothing on reads) against a real `FORCE ROW LEVEL SECURITY` table, the
 * one thing this sandbox's Prisma-toolchain limitation meant nobody could
 * catch by actually running it. This store is what makes `.tenant` resolve
 * to a REAL RLS-activated transaction client for the lifetime of a request,
 * without changing the call signature of a single already-written service
 * method.
 *
 * Typed as `TenantPrismaClient` (prisma.service.ts), not the base
 * `PrismaClient` — a real, previously-uncaught Docker-build break (see that
 * file's header comment): the value actually stored here is always the
 * result of `$extends(tenantScopingExtension())`, whose real generated type
 * is not assignable to plain `PrismaClient`. `import type` avoids a runtime
 * circular-import between this file and prisma.service.ts — it's erased at
 * compile time, so the two files' mutual reference is type-only.
 */
export const tenantTxStorage = new AsyncLocalStorage<TenantPrismaClient>();
