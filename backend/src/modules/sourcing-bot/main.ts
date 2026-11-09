import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaModule } from '../../prisma/prisma.module';
import { SourcingBotModule } from './sourcing-bot.module';

/**
 * Standalone entry point for the procurement sourcing bot (2026-11-09) —
 * see `sourcing-bot.module.ts`'s header comment for why this is its own
 * process rather than folded into the main `sh-erp-backend` app. No HTTP
 * listener — `createApplicationContext` boots just enough of Nest's DI
 * graph (Prisma + this one module) to run `SourcingBotService`'s
 * long-polling loop, started from that service's own `onModuleInit`.
 */
@Module({ imports: [PrismaModule, SourcingBotModule] })
class SourcingBotAppModule {}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(SourcingBotAppModule);
  app.enableShutdownHooks();
  // eslint-disable-next-line no-console
  console.log('sourcing-bot: started, long-polling Telegram for updates');
}

bootstrap();
