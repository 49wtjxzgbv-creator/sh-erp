import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Same pattern and rationale as `telegram-bot-prisma.service.ts` (which
 * itself mirrors `import-pairing-prisma.service.ts`/`auth-prisma.service.ts`,
 * ADR-0009) — see that file's header comment for the full argument, and
 * `prisma/migrations/20261109180000_procurement_sourcing_bot/` for this
 * role's exact grants (SELECT+UPDATE on `users` only, SELECT on
 * `company_memberships`/`companies`, nothing else, no DELETE, no INSERT).
 *
 * Kept as its OWN role/service (`sourcing_bot_service`), not a reuse of
 * `TelegramBotPrismaService`/`telegram_bot_service` — this is a separate,
 * independently-deployed bot (own systemd unit, own Telegram token); its
 * blast radius must stay independent of the existing production-
 * notifications bot's.
 *
 * Needed because the sourcing bot's long-polling loop resolves an inbound
 * chat id (or, during the one-time pairing step, a bare pairing code) to a
 * `User` row BEFORE any tenant/company context exists — structurally
 * impossible under strict RLS with `app_user` correctly lacking
 * `BYPASSRLS`. Once identity (and therefore companyId, via the user's
 * `CompanyMembership`) is resolved, every subsequent business operation
 * switches to the normal `PrismaService#runInTenantTransaction` path.
 *
 * USAGE BOUNDARY (enforced structurally, not just by convention): this
 * class is provided ONLY by `SourcingBotModule` and is NOT exported from
 * it — no other module can inject it. It must NEVER be used once a
 * companyId has been resolved.
 */
@Injectable()
export class SourcingBotPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SourcingBotPrismaService.name);

  constructor() {
    super({ datasourceUrl: process.env.SOURCING_BOT_DATABASE_URL ?? process.env.DATABASE_URL });
    if (!process.env.SOURCING_BOT_DATABASE_URL) {
      this.logger.warn(
        'SOURCING_BOT_DATABASE_URL not set — falling back to DATABASE_URL (the app_user role). ' +
          'If app_user does not have BYPASSRLS or ownership of users, pairing will fail under RLS. ' +
          'Same disclosed-gap shape as TelegramBotPrismaService, resolve before production use.',
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
