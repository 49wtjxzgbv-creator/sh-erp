import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory.module';
import { AiModule } from '../../ai/ai.module';
import { InvoiceStockImportController } from './invoice-stock-import.controller';
import { InvoiceStockImportService } from './invoice-stock-import.service';

/**
 * A leaf consumer of both InventoryModule (StockService) and AiModule
 * (AiService, used only as the fallback path — see service header comment).
 * AiModule already imports InventoryModule itself; living here, one level
 * above both, avoids turning that into a cycle (no forwardRef needed).
 */
@Module({
  imports: [InventoryModule, AiModule],
  controllers: [InvoiceStockImportController],
  providers: [InvoiceStockImportService],
})
export class InvoiceStockImportModule {}
