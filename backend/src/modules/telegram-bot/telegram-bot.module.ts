import { Module } from '@nestjs/common';
import { ProductionModule } from '../production/production.module';
import { TelegramBotPrismaService } from '../../prisma/telegram-bot-prisma.service';
import { TelegramApiClient } from './telegram-api.client';
import { TelegramBotController } from './telegram-bot.controller';
import { TelegramBotService } from './telegram-bot.service';

@Module({
  // ProductionExecutionsService — creates the DRAFT submission. Assembly/
  // ProductionOrder reads go straight through prisma.tenant inside
  // TelegramBotService itself, no AssembliesService/ProductionOrdersService
  // dependency needed for this V1 (PRODUCT-only — no WorkTask/GENERAL
  // submission path yet).
  imports: [ProductionModule],
  controllers: [TelegramBotController],
  // TelegramBotPrismaService is deliberately NOT exported — same usage
  // boundary as ImportPairingPrismaService (see that class's own header
  // comment): only TelegramBotService's identity-resolution helpers may
  // use it, enforced by module scoping, not just convention.
  providers: [TelegramBotService, TelegramApiClient, TelegramBotPrismaService],
})
export class TelegramBotModule {}
