import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Same pattern and rationale as `import-pairing-prisma.service.ts` (which
 * itself mirrors `auth-prisma.service.ts`, ADR-0009) — see that file's
 * header comment for the full argument, and
 * `prisma/migrations/20261001000001_create_telegram_bot_service_role/` for
 * the role's exact grants (SELECT+UPDATE on `employees` only, nothing
 * else, no DELETE, no INSERT).
 *
 * Needed because `POST /telegram/webhook` is called by Telegram's own
 * servers (an anonymous actor, no SH ERP JWT) — it must resolve an inbound
 * message to an `Employee` row purely from the Telegram chat id, or (during
 * the one-time pairing step) from a bare pairing code, BEFORE any
 * tenant/company context exists, which is structurally impossible under
 * strict RLS with `app_user` correctly lacking `BYPASSRLS`.
 *
 * USAGE BOUNDARY (enforced structurally, not just by convention): this
 * class is provided ONLY by `TelegramBotModule` and is NOT exported from
 * it — no other module can inject it. It must NEVER be used once a
 * companyId has been resolved — every legitimate use lives in
 * `TelegramBotService`'s own identity-resolution helpers; everything after
 * that (listing production orders, creating a DRAFT ProductionExecution)
 * switches to the normal `PrismaService#runInTenantTransaction` path, same
 * handoff shape as `LegacyImportService#completePairing` ->
 * `runHealthCheckAndPersist`.
 */
@Injectable()
export class TelegramBotPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotPrismaService.name);

  constructor() {
    super({ datasourceUrl: process.env.TELEGRAM_BOT_DATABASE_URL ?? process.env.DATABASE_URL });
    if (!process.env.TELEGRAM_BOT_DATABASE_URL) {
      this.logger.warn(
        'TELEGRAM_BOT_DATABASE_URL not set — falling back to DATABASE_URL (the app_user role). ' +
          'If app_user does not have BYPASSRLS or ownership of employees, the Telegram webhook ' +
          'will fail under RLS. Same disclosed-gap shape as AuthPrismaService/ImportPairingPrismaService, ' +
          'resolve before production use.',
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
