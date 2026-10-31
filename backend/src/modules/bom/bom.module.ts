import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { FinanceModule } from '../finance/finance.module';
import { FilesModule } from '../files/files.module';
import { AssembliesController } from './assemblies.controller';
import { AssembliesService } from './assemblies.service';
import { StepBomExtractionService } from './step-bom-extraction.service';

@Module({
  // InventoryModule for StockService (produce() consumes components through the same ledger as every other stock mutation);
  // FinanceModule for ExchangeRatesService (multi-currency cost conversion, 2026-10-29);
  // FilesModule for FilesService/StepConversionService (StepBomExtractionService, "креслення → специфікація", 2026-10-31)
  imports: [InventoryModule, FinanceModule, FilesModule],
  controllers: [AssembliesController],
  providers: [AssembliesService, StepBomExtractionService],
  exports: [AssembliesService],
})
export class BomModule {}
