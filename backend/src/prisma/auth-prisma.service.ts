import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * APPROVED (owner sign-off given explicitly) — see ADR-0009
 * (docs/adr/0009-auth-service-bypassrls-role.md) for the full security
 * rationale and database-schema.md §2c for how this fits into the
 * two-layer tenant isolation model (ADR-0002). The raw-SQL role/GRANT
 * statements are in prisma/migrations/<timestamp>_create_auth_service_role/
 * migration.sql.
 *
 * The pre-tenant-context flows (AuthService: login, refresh, and company
 * discovery — the pre-login "which company, what branding" lookup) must
 * read/write a handful of tables BEFORE a tenant/company is known, which is
 * structurally impossible under strict RLS with `app_user` correctly
 * lacking `BYPASSRLS` (database-schema.md §2): a connection that never
 * issues `SET LOCAL app.current_company_id` sees zero rows on any
 * FORCE-RLS table. This client connects instead as a SEPARATE, narrowly
 * scoped role, `auth_service`, with `BYPASSRLS` — distinct from `app_user`,
 * which remains exactly as documented and is used for all normal
 * per-request tenant-scoped traffic.
 *
 * Exact grants (least-privilege, no DELETE anywhere, see the migration for
 * the authoritative SQL):
 *   - `users`: SELECT, UPDATE (UPDATE only for the legacy-password-rehash
 *     write in AuthService.verifyPassword)
 *   - `companies`: SELECT (not RLS-scoped at all, granted for completeness)
 *   - `company_memberships`: SELECT only (login/refresh never write it)
 *   - `refresh_tokens`: SELECT, INSERT, UPDATE (issue/rotate/revoke)
 *   - `company_branding`: SELECT only (pre-login branding lookup — Phase 1
 *     §3.6's `getBrandingAssets`, deliberately not auth-gated)
 *
 * `BYPASSRLS` is narrower than it sounds: every query this role runs is
 * already scoped by a value that uniquely identifies at most one relevant
 * row on its own (email, tokenHash, or an explicit companyId+userId pair)
 * — the risk RLS normally guards against (a request scoped to tenant A
 * reading tenant B's rows) doesn't apply to a code path whose entire job
 * is determining which tenant something belongs to.
 *
 * USAGE BOUNDARY (enforced structurally, not just by convention): this
 * class is provided ONLY by IdentityModule and is NOT exported from it —
 * no other module can inject it. It must NEVER be used once a request has
 * resolved a tenant context (i.e. never inside anything reachable after
 * `TenantScopeInterceptor` has run) — every legitimate use of this client
 * lives in `AuthService`, and every one of its methods runs strictly
 * BEFORE that interceptor's transaction would even apply (login/refresh/
 * company-discovery are all `@Public()` routes).
 */
@Injectable()
export class AuthPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthPrismaService.name);

  constructor() {
    super({ datasourceUrl: process.env.AUTH_DATABASE_URL ?? process.env.DATABASE_URL });
    if (!process.env.AUTH_DATABASE_URL) {
      this.logger.warn(
        'AUTH_DATABASE_URL not set — falling back to DATABASE_URL (the app_user role). ' +
          'If app_user does not have BYPASSRLS or ownership of users/companies/' +
          'company_memberships/refresh_tokens, login and refresh will fail under RLS. ' +
          'This is the disclosed gap in database-schema.md §2c — resolve before production use.',
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
