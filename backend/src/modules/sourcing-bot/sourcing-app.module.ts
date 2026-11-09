import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { FilesModule } from '../files/files.module';
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
 */
@Module({
  imports: [PrismaModule, FilesModule, SourcingBotModule],
  controllers: [SourcingAppController],
  providers: [SourcingAppService, TelegramWebAppAuthGuard],
})
export class SourcingAppModule {}
