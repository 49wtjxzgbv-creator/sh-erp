import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Same bootstrapping problem ADR-0009 solved for `AuthPrismaService`, for
 * the same reason: `SupplierPortalAuthService.login()` looks a portal user
 * up by email BEFORE a companyId is known (determining it is the point of
 * the lookup) — structurally impossible through `supplier_portal_users`'
 * FORCE RLS via the regular `app_user` role. Rather than exporting
 * `AuthPrismaService` outside `IdentityModule` (breaking its own
 * documented "not exported, no other module can inject it" boundary),
 * this is a fourth, separately-scoped `BYPASSRLS` role,
 * `supplier_portal_auth_service` — grants live in
 * prisma/migrations/20260813000000_supplier_portal/migration.sql, table:
 * `supplier_portal_users` only (SELECT + UPDATE for `lastLoginAt`).
 *
 * USAGE BOUNDARY (enforced structurally, not just by convention): provided
 * ONLY by `SupplierPortalModule` and NOT exported from it — no other
 * module can inject it. Must NEVER be used once a request has resolved a
 * REGULAR (Company/app_user) tenant context.
 *
 * Multi-company redesign (2026-08-21 P0, ADR-0012): now also used by
 * `SupplierPortalScopeInterceptor` itself — determining WHICH company a
 * request is scoped to is now a pre-tenant-context lookup (the active
 * `SupplierConnection`'s companyId), the same class of problem login
 * already had, not a rule violation. Grants extended to `supplier_connections`
 * (SELECT/UPDATE) and `supplier_organizations` (SELECT) in that same migration.
 */
@Injectable()
export class SupplierPortalAuthPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SupplierPortalAuthPrismaService.name);

  constructor() {
    super({ datasourceUrl: process.env.SUPPLIER_PORTAL_AUTH_DATABASE_URL ?? process.env.DATABASE_URL });
    if (!process.env.SUPPLIER_PORTAL_AUTH_DATABASE_URL) {
      this.logger.warn(
        'SUPPLIER_PORTAL_AUTH_DATABASE_URL not set — falling back to DATABASE_URL (the app_user role). ' +
          'If app_user does not have BYPASSRLS, supplier portal login will fail under RLS.',
      );
    }
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
