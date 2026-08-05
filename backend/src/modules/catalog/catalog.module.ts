import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { CompanyUnitsController } from './company-units.controller';
import { CompanyUnitsService } from './company-units.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductsImportExportService } from './import-export/products-import-export.service';

@Module({
  // for StockService — ProductsImportExportService.importProducts() posts
  // any imported qty as a real ADJUST movement through the same ledger as
  // every other stock mutation (Production/Procurement/BOM already follow
  // this exact cross-module pattern, see their own module files)
  imports: [InventoryModule],
  controllers: [ProductsController, CompanyUnitsController],
  providers: [ProductsService, CompanyUnitsService, ProductsImportExportService],
  exports: [ProductsService, CompanyUnitsService],
})
export class CatalogModule {}
