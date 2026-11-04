import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FilesModule } from '../files/files.module';
import { FinanceModule } from '../finance/finance.module';
import { ProductionModule } from '../production/production.module';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseRequestsController } from './purchase-requests.controller';
import { PurchaseRequestsService } from './purchase-requests.service';
import { PurchaseRequestRendererService } from './purchase-request-renderer.service';
import { PurchaseRequestPdfService } from './purchase-request-pdf.service';
import { PurchaseOrderRendererService } from './purchase-order-renderer.service';
import { PurchaseOrderPdfService } from './purchase-order-pdf.service';
import { DeliverySchedulesService } from './delivery-schedules.service';
import { PurchaseOrderCommentsService } from './purchase-order-comments.service';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';
import { SupplierCatalogService } from './supplier-catalog.service';

@Module({
  imports: [
    InventoryModule, // for StockService — PurchaseOrdersService.receive() posts RECEIVE movements through the same ledger as every other stock mutation
    NotificationsModule, // for EmailService — SuppliersService#invitePortal emails the supplier's temp password; also Phase 2 lifecycle notifications
    FilesModule, // for FilesService — PurchaseRequestPdfService#generateAndStore stores the rendered PDF as a FileAsset (no circular-import risk: FilesModule has no imports of its own)
    FinanceModule, // for ExchangeRatesService#getBaseCurrency — PurchaseOrdersService.create() defaults currency to the company's own base currency (2026-10-29 multi-currency)
    ProductionModule, // for FinishedGoodsService#receivePurchased — PurchaseOrdersService.receive()'s виріб branch (2026-11-04). Safe direction: ProductionModule only imports InventoryModule/HrModule, no cycle back through ProcurementModule.
  ],
  controllers: [SuppliersController, PurchaseOrdersController, PurchaseRequestsController],
  providers: [
    SuppliersService,
    PurchaseOrdersService,
    PurchaseRequestsService,
    PurchaseRequestRendererService,
    PurchaseRequestPdfService,
    PurchaseOrderRendererService,
    PurchaseOrderPdfService,
    DeliverySchedulesService,
    PurchaseOrderCommentsService,
    SupplierCatalogService,
  ],
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
