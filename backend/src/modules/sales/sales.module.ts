import { Module } from '@nestjs/common';
import { BomModule } from '../bom/bom.module';
import { ProcurementModule } from '../procurement/procurement.module';
import { ProductionModule } from '../production/production.module';
import { CustomerOrderShortageService } from './customer-order-shortage.service';
import { CustomerOrdersController } from './customer-orders.controller';
import { CustomerOrdersService } from './customer-orders.service';
import { ShipmentsController } from './shipments.controller';
import { ShipmentsService } from './shipments.service';

@Module({
  imports: [ProductionModule, ProcurementModule, BomModule], // ProductionOrdersService (give-to-production) + PurchaseOrdersService (shortage → PO) + AssembliesService (estimated price on the orders list)
  controllers: [CustomerOrdersController, ShipmentsController],
  providers: [CustomerOrdersService, CustomerOrderShortageService, ShipmentsService],
  exports: [CustomerOrdersService, CustomerOrderShortageService, ShipmentsService],
})
export class SalesModule {}
