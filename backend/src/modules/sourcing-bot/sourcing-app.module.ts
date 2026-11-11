import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { FilesModule } from '../files/files.module';
import { AiSettingsService } from '../ai/ai-settings.service';
import { GeminiAdapter } from '../ai/providers/gemini.adapter';
import { DeepSeekAdapter } from '../ai/providers/deepseek.adapter';
import { EmailService } from '../notifications/email.service';
import { OutreachLetterRendererService } from './outreach-letter-renderer.service';
import { SourcingBotModule } from './sourcing-bot.module';
import { SourcingAppController } from './sourcing-app.controller';
import { SourcingAppService } from './sourcing-app.service';
import { TelegramWebAppAuthGuard } from './telegram-webapp-auth.guard';

/**
 * The Mini App's HTTP surface (2026-11-10 — "веб версію як застосунок").
 * Imports `SourcingBotModule` purely to reuse its exported
 * `SourcingIdentityService` (so the Mini App and the chat bot resolve
 * "who is this Telegram user" through the exact same code, never two
 * copies that drift) — this module adds no new Telegram bot/token, no new
 * long-polling loop, just a guarded REST API on top of the same data.
 *
 * `AiSettingsService`/`GeminiAdapter`/`DeepSeekAdapter` (2026-11-10, name
 * translation) are provided directly here rather than importing the full
 * `AiModule` —
 * that module's own tool registry transitively drags in Bom/Sales/
 * Inventory/Hr/Reports, exactly the unrelated coupling this standalone
 * process's isolation is meant to avoid (see `sourcing-bot.module.ts`'s
 * header comment). Both classes' own real dependencies (`PrismaService`,
 * the globally-registered `AuditService`) are already satisfied by what
 * this module tree imports/has imported elsewhere.
 *
 * `EmailService` (2026-11-11, outreach-letter feature) is similarly
 * standalone — no injected dependencies of its own beyond env vars — so it
 * is provided directly too, rather than importing the whole
 * `NotificationsModule` (which also registers `LowStockDigestService`/
 * `NotificationsController`, unrelated to this process).
 */
@Module({
  imports: [PrismaModule, FilesModule, SourcingBotModule],
  controllers: [SourcingAppController],
  providers: [SourcingAppService, TelegramWebAppAuthGuard, AiSettingsService, GeminiAdapter, DeepSeekAdapter, EmailService, OutreachLetterRendererService],
})
export class SourcingAppModule {}
