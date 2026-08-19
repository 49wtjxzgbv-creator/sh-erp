import { Module } from '@nestjs/common';
import { BomModule } from '../bom/bom.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ProcurementModule } from '../procurement/procurement.module';
import { ProductionModule } from '../production/production.module';
import { CustomerOrderShortageService } from './customer-order-shortage.service';
import { CustomerOrdersController } from './customer-orders.controller';
import { CustomerOrdersService } from './customer-orders.service';
import { MaterialProvisioningController } from './material-provisioning.controller';
import { MaterialProvisioningService } from './material-provisioning.service';
import { ShipmentsController } from './shipments.controller';
import { ShipmentsService } from './shipments.service';

@Module({
  imports: [ProductionModule, ProcurementModule, BomModule, InventoryModule], // ProductionOrdersService (give-to-production) + PurchaseOrdersService (shortage → PO) + AssembliesService (estimated price on the orders list) + StockReservationService (material provisioning, cancel release)
  controllers: [CustomerOrdersController, ShipmentsController, MaterialProvisioningController],
  providers: [CustomerOrdersService, CustomerOrderShortageService, ShipmentsService, MaterialProvisioningService],
  exports: [CustomerOrdersService, CustomerOrderShortageService, ShipmentsService, MaterialProvisioningService],
})
export class SalesModule {}
