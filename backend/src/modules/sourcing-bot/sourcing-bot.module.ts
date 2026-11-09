import { Module } from '@nestjs/common';
import { SourcingBotPrismaService } from '../../prisma/sourcing-bot-prisma.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { FilesModule } from '../files/files.module';
import { SourcingBotApiClient } from './sourcing-bot-api.client';
import { SourcingBotService } from './sourcing-bot.service';

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
 * comment): only `SourcingBotService`'s identity-resolution helpers may
 * use it.
 *
 * `FilesModule` — reuses `FilesService#getDownloadUrl` to send a product's
 * existing PRODUCT_PHOTO straight to Telegram via `sendPhoto` with a
 * presigned R2 URL (2026-11-09 user request — "мав на увазі фото
 * товару"), same presign-and-hand-to-the-client pattern every other photo
 * flow in this backend already uses — no new storage/upload path.
 */
@Module({
  imports: [PrismaModule, FilesModule],
  providers: [SourcingBotService, SourcingBotApiClient, SourcingBotPrismaService],
})
export class SourcingBotModule {}
