import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { DeliverySchedulesService } from './delivery-schedules.service';
import { PurchaseOrderCommentsService } from './purchase-order-comments.service';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';

@Module({
  imports: [
    InventoryModule, // for StockService — PurchaseOrdersService.receive() posts RECEIVE movements through the same ledger as every other stock mutation
    NotificationsModule, // for EmailService — SuppliersService#invitePortal emails the supplier's temp password; also Phase 2 lifecycle notifications
  ],
  controllers: [SuppliersController, PurchaseOrdersController],
  providers: [SuppliersService, PurchaseOrdersService, DeliverySchedulesService, PurchaseOrderCommentsService],
  // DeliverySchedulesService/PurchaseOrderCommentsService exported so
  // SupplierPortalModule can share the same state machines (Phase 1/2)
  // rather than duplicating them.
  exports: [SuppliersService, PurchaseOrdersService, DeliverySchedulesService, PurchaseOrderCommentsService],
})
export class ProcurementModule {}
