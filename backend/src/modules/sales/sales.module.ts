import { Module } from '@nestjs/common';
import { BomModule } from '../bom/bom.module';
import { FilesModule } from '../files/files.module';
import { FinanceModule } from '../finance/finance.module';
import { InventoryModule } from '../inventory/inventory.module';
import { LogisticsModule } from '../logistics/logistics.module';
import { ProcurementModule } from '../procurement/procurement.module';
import { ProductionModule } from '../production/production.module';
import { CustomerOrderShortageService } from './customer-order-shortage.service';
import { CustomerOrdersController } from './customer-orders.controller';
import { CustomerOrdersService } from './customer-orders.service';
import { LoadPlanController } from './load-plan.controller';
import { LoadPlanService } from './load-plan.service';
import { ShipmentsController } from './shipments.controller';
import { ShipmentsService } from './shipments.service';
import { SupplierRequestDocumentsPdfService } from './supplier-request-documents-pdf.service';

@Module({
  imports: [ProductionModule, ProcurementModule, BomModule, InventoryModule, FinanceModule, FilesModule, LogisticsModule], // ProductionOrdersService (give-to-production) + PurchaseOrdersService (shortage → PO) + AssembliesService (estimated price on the orders list, also shipment-weight calc) + StockReservationService (auto-reserve at order creation, release on cancel) + FinanceService (profit report's additionalExpenses) + FilesService (SupplierRequestDocumentsPdfService reading attachment bytes) + TransportUnitTypesService (shipment transport-count suggestion + load-plan 3D packing)
  controllers: [CustomerOrdersController, ShipmentsController, LoadPlanController],
  providers: [CustomerOrdersService, CustomerOrderShortageService, ShipmentsService, SupplierRequestDocumentsPdfService, LoadPlanService],
  exports: [CustomerOrdersService, CustomerOrderShortageService, ShipmentsService, LoadPlanService],
})
export class SalesModule {}
