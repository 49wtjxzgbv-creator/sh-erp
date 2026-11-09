import { Module } from '@nestjs/common';
import { SourcingBotPrismaService } from '../../prisma/sourcing-bot-prisma.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { FilesModule } from '../files/files.module';
import { AuditModule } from '../audit/audit.module';
import { SourcingBotApiClient } from './sourcing-bot-api.client';
import { SourcingBotService } from './sourcing-bot.service';
import { SourcingIdentityService } from './sourcing-identity.service';

/**
 * Procurement sourcing bot (2026-11-09) — deliberately NOT part of
 * `TelegramBotModule`/the main `sh-erp-backend` app. This boots as its own
 * standalone process (see `main.ts` in this directory — a NestJS
 * application context, no HTTP listener), with its own systemd unit
 * (`sh-erp-sourcing-bot.service`) and its own Telegram bot/token, so a bug
 * in this new, less-tested tool can never affect the core ERP backend.
 * Long-polling (`getUpdates`), not a webhook — a standalone process has no
 * existing public route/Nginx config to piggyback on, and long-polling
 * needs neither.
 *
 * `SourcingBotPrismaService` is deliberately NOT exported — same usage
 * boundary as `TelegramBotPrismaService` (see that class's own header
 * comment): only `SourcingIdentityService` may use it directly.
 * `SourcingIdentityService` itself IS exported (2026-11-10, "веб версію як
 * застосунок") — `SourcingAppModule`'s `TelegramWebAppAuthGuard` imports
 * this module just to reuse it, so chat and Mini App identity resolution
 * can never drift apart.
 *
 * `FilesModule` — reuses `FilesService#getDownloadUrl` to send a product's
 * existing PRODUCT_PHOTO straight to Telegram via `sendPhoto` with a
 * presigned R2 URL (2026-11-09 user request — "мав на увазі фото
 * товару"), same presign-and-hand-to-the-client pattern every other photo
 * flow in this backend already uses — no new storage/upload path.
 * `AuditModule` — `@Global()` in the main app, but this standalone
 * process's own tiny module tree (see main.ts) never imports it on its
 * own, and `FilesService` depends on `AuditService` directly; without
 * this the bot fails to boot at all ("Nest can't resolve dependencies of
 * the FilesService... AuditService").
 */
@Module({
  imports: [PrismaModule, FilesModule, AuditModule],
  providers: [SourcingBotService, SourcingBotApiClient, SourcingBotPrismaService, SourcingIdentityService],
  exports: [SourcingIdentityService],
})
export class SourcingBotModule {}
