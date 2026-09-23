import { Module } from '@nestjs/common';
import { BomModule } from '../bom/bom.module';
import { FilesModule } from '../files/files.module';
import { FinanceModule } from '../finance/finance.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ProcurementModule } from '../procurement/procurement.module';
import { ProductionModule } from '../production/production.module';
import { CustomerOrderShortageService } from './customer-order-shortage.service';
import { CustomerOrdersController } from './customer-orders.controller';
import { CustomerOrdersService } from './customer-orders.service';
import { ShipmentsController } from './shipments.controller';
import { ShipmentsService } from './shipments.service';
import { SupplierRequestDocumentsPdfService } from './supplier-request-documents-pdf.service';

@Module({
  imports: [ProductionModule, ProcurementModule, BomModule, InventoryModule, FinanceModule, FilesModule], // ProductionOrdersService (give-to-production) + PurchaseOrdersService (shortage → PO) + AssembliesService (estimated price on the orders list) + StockReservationService (auto-reserve at order creation, release on cancel) + FinanceService (profit report's additionalExpenses) + FilesService (SupplierRequestDocumentsPdfService reading attachment bytes)
  controllers: [CustomerOrdersController, ShipmentsController],
  providers: [CustomerOrdersService, CustomerOrderShortageService, ShipmentsService, SupplierRequestDocumentsPdfService],
  exports: [CustomerOrdersService, CustomerOrderShortageService, ShipmentsService],
})
export class SalesModule {}
