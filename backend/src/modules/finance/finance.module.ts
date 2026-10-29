import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { ExchangeRatesController } from './exchange-rates.controller';
import { ExchangeRatesService } from './exchange-rates.service';

@Module({
  controllers: [FinanceController, ExchangeRatesController],
  providers: [FinanceService, ExchangeRatesService],
  exports: [FinanceService, ExchangeRatesService],
})
export class FinanceModule {}
