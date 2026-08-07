import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Same pattern and rationale as `auth-prisma.service.ts` (ADR-0009) — see
 * that file's header comment for the full argument, and
 * `prisma/migrations/20260807130000_create_import_pairing_service_role/`
 * for the role's exact grants (SELECT+UPDATE on `import_connections` only,
 * nothing else, no DELETE).
 *
 * Needed because `POST /legacy-import/connections/pair` is called by an
 * anonymous connector script (the device-pairing handshake's "complete
 * setup" step), not an authenticated SH ERP user — it must look up an
 * `ImportConnection` row by `pairingCode` alone, before any tenant/company
 * context exists, which is structurally impossible under strict RLS with
 * `app_user` correctly lacking `BYPASSRLS`.
 *
 * USAGE BOUNDARY (enforced structurally, not just by convention): this
 * class is provided ONLY by `LegacyImportModule` and is NOT exported from
 * it — no other module can inject it. It must NEVER be used once a
 * request has resolved a tenant context; every legitimate use lives in the
 * one `completePairing` code path in `legacy-import.service.ts`, which is
 * a `@Public()`-equivalent route (no `RequirePermissions` guard) reachable
 * before any tenant context could exist.
 */
@Injectable()
export class ImportPairingPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImportPairingPrismaService.name);

  constructor() {
    super({ datasourceUrl: process.env.IMPORT_PAIRING_DATABASE_URL ?? process.env.DATABASE_URL });
    if (!process.env.IMPORT_PAIRING_DATABASE_URL) {
      this.logger.warn(
        'IMPORT_PAIRING_DATABASE_URL not set — falling back to DATABASE_URL (the app_user role). ' +
          'If app_user does not have BYPASSRLS or ownership of import_connections, the pairing endpoint ' +
          'will fail under RLS. Same disclosed-gap shape as AuthPrismaService — resolve before production use.',
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
