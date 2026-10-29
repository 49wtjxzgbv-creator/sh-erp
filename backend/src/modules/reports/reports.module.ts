import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [FinanceModule], // ExchangeRatesService — getWarehouseValuation converts each product's own-currency sellPriceEur to EUR before summing (2026-10-29 multi-currency)
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
