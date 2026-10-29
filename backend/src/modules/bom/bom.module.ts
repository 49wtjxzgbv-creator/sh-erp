import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { FinanceModule } from '../finance/finance.module';
import { AssembliesController } from './assemblies.controller';
import { AssembliesService } from './assemblies.service';

@Module({
  imports: [InventoryModule, FinanceModule], // InventoryModule for StockService (produce() consumes components through the same ledger as every other stock mutation); FinanceModule for ExchangeRatesService (multi-currency cost conversion, 2026-10-29)
  controllers: [AssembliesController],
  providers: [AssembliesService],
  exports: [AssembliesService],
})
export class BomModule {}
