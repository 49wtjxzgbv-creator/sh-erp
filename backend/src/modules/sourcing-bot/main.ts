import { Module, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import helmet from 'helmet';
import { PrismaModule } from '../../prisma/prisma.module';
import { SourcingBotModule } from './sourcing-bot.module';
import { SourcingAppModule } from './sourcing-app.module';
import { SourcingHealthController } from './sourcing-health.controller';

/**
 * Standalone entry point for the procurement sourcing bot (2026-11-09),
 * extended (2026-11-10 — "веб версію як застосунок") to ALSO serve the
 * Mini App's small HTTP API. Still its own process, own systemd unit, own
 * Postgres role — see `sourcing-bot.module.ts`'s header comment for the
 * full isolation rationale from the core `sh-erp-backend` app; a crash or
 * bug in this HTTP surface still can't take down the main ERP API. One
 * process now does two jobs (long-polling Telegram's `getUpdates` AND
 * serving HTTP) — acceptable, since isolation from the MAIN backend is
 * what actually matters here, not isolation between this bot's own two
 * jobs. `SourcingBotService#onModuleInit` starts the polling loop
 * automatically as part of Nest's normal module-init lifecycle, same as
 * it always did under `createApplicationContext` — nothing extra to call.
 */
// ScheduleModule.forRoot() is registered in the MAIN backend's own
// app.module.ts already, but this is a fully separate process (see this
// file's own header comment) — @Cron decorators (StaleOutreachReminderService)
// do nothing unless this process registers its own scheduler too.
@Module({ imports: [PrismaModule, ScheduleModule.forRoot(), SourcingBotModule, SourcingAppModule], controllers: [SourcingHealthController] })
class SourcingBotAppModule {}

async function bootstrap() {
  const app = await NestFactory.create(SourcingBotAppModule, { bufferLogs: false });
  app.enableShutdownHooks();

  // Same baseline hardening as the main backend's own main.ts — this is a
  // real public HTTP listener now, not just an in-process polling loop.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  // The Mini App is served by the MAIN frontend's Next.js app
  // (`frontend/app/sourcing-app/`) at FRONTEND_URL, calling this API
  // cross-origin — same shape as the main backend's own CORS setup, just
  // no credentials (auth here is the X-Telegram-Init-Data header, not a
  // cookie).
  const frontendUrl = process.env.FRONTEND_URL;
  app.enableCors({ origin: frontendUrl ? frontendUrl.split(',').map((o) => o.trim()) : !process.env.NODE_ENV || process.env.NODE_ENV !== 'production' });

  const port = Number(process.env.SOURCING_APP_PORT ?? 3003);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`sourcing-bot: long-polling Telegram for updates, HTTP API on :${port}`);
}

bootstrap();
