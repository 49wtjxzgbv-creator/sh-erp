import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { DeliverySchedulesService } from './delivery-schedules.service';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';

@Module({
  imports: [
    InventoryModule, // for StockService — PurchaseOrdersService.receive() posts RECEIVE movements through the same ledger as every other stock mutation
    NotificationsModule, // for EmailService — SuppliersService#invitePortal emails the supplier's temp password
  ],
  controllers: [SuppliersController, PurchaseOrdersController],
  providers: [SuppliersService, PurchaseOrdersService, DeliverySchedulesService],
  // DeliverySchedulesService exported so SupplierPortalModule can share the
  // same accept/reject/confirm/propose state machine (Phase 1) rather than
  // duplicating it.
  exports: [SuppliersService, PurchaseOrdersService, DeliverySchedulesService],
})
export class ProcurementModule {}
