import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Third BYPASSRLS Prisma client in this codebase, alongside `PrismaService`
 * (RLS-bound, via `.tenant`) and `AuthPrismaService` (ADR-0009, narrowly
 * scoped to 3 pre-tenant-context auth flows). This one backs the Super
 * Admin feature set added during the 2026-08-05 production-readiness audit
 * — a genuinely global "system operator" role that must see/manage every
 * company, not just one. Connects as `super_admin_service`
 * (prisma/migrations/20260805100000_add_super_admin/migration.sql), which
 * is BYPASSRLS but otherwise least-privilege: it only has grants on the
 * exact tables Super Admin functionality touches (see that migration's own
 * comments for the authoritative list) — NOT a blanket bypass reused
 * casually, and NOT the same role as `auth_service` (ADR-0010 explains why
 * these stay separate rather than widening auth_service's grant list).
 *
 * USAGE BOUNDARY (enforced structurally, same pattern as AuthPrismaService):
 * this class is provided ONLY by SuperAdminModule and is NOT exported from
 * it — no other module can inject it. Every legitimate use lives in this
 * module's own services, all of which sit behind SuperAdminGuard, never
 * behind the regular JwtAuthGuard/TenantScopeInterceptor pipeline.
 */
@Injectable()
export class SuperAdminPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SuperAdminPrismaService.name);

  constructor() {
    super({ datasourceUrl: process.env.SUPER_ADMIN_DATABASE_URL ?? process.env.DATABASE_URL });
    if (!process.env.SUPER_ADMIN_DATABASE_URL) {
      this.logger.warn(
        'SUPER_ADMIN_DATABASE_URL not set — falling back to DATABASE_URL (the app_user role). ' +
          'If app_user does not have BYPASSRLS or ownership of the tables ' +
          'super_admin_service needs (see the migration this class points at), every Super ' +
          'Admin endpoint will silently see zero rows under real RLS. Resolve before production use.',
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
