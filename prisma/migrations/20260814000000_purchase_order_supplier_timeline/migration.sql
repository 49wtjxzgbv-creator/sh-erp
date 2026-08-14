-- Additive only. Staff-tracked supplier-request timeline for Склад's
-- "Очікується від постачальника" tab — independent of PurchaseOrder.status
-- and PurchaseOrderItem.qtyReceived, which stay driven purely by the
-- existing receive() flow.

ALTER TABLE "purchase_orders"
  ADD COLUMN "plannedSendAt" TIMESTAMPTZ(3),
  ADD COLUMN "sentToSupplierAt" TIMESTAMPTZ(3),
  ADD COLUMN "shippedBySupplierAt" TIMESTAMPTZ(3),
  ADD COLUMN "deliveredAt" TIMESTAMPTZ(3);
