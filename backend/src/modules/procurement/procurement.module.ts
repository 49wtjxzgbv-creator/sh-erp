import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseRequestsController } from './purchase-requests.controller';
import { PurchaseRequestsService } from './purchase-requests.service';
import { DeliverySchedulesService } from './delivery-schedules.service';
import { PurchaseOrderCommentsService } from './purchase-order-comments.service';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';

@Module({
  imports: [
    InventoryModule, // for StockService — PurchaseOrdersService.receive() posts RECEIVE movements through the same ledger as every other stock mutation
    NotificationsModule, // for EmailService — SuppliersService#invitePortal emails the supplier's temp password; also Phase 2 lifecycle notifications
  ],
  controllers: [SuppliersController, PurchaseOrdersController, PurchaseRequestsController],
  providers: [SuppliersService, PurchaseOrdersService, PurchaseRequestsService, DeliverySchedulesService, PurchaseOrderCommentsService],
  // DeliverySchedulesService/PurchaseOrderCommentsService exported so
  // SupplierPortalModule can share the same state machines (Phase 1/2)
  // rather than duplicating them. PurchaseRequestsService NOT imported by
  // QuotationsModule's DocumentNumberingService (would create a cycle:
  // ProcurementModule -> QuotationsModule -> SalesModule ->
  // ProcurementModule, since SalesModule already imports ProcurementModule)
  // — it inlines the same atomic-counter query itself instead.
  exports: [SuppliersService, PurchaseOrdersService, PurchaseRequestsService, DeliverySchedulesService, PurchaseOrderCommentsService],
})
export class ProcurementModule {}
