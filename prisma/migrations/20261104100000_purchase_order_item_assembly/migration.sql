-- Замовлення постачальнику: дозволити позиції-вироби, не лише товари
-- (2026-11-04). `purchase_order_items.assemblyId` alongside the existing
-- `productId` — at most one set, enforced by a CHECK constraint mirroring
-- `cutting_plan_source_consistency` (prisma/migrations/
-- 20261101090540_adhoc_cutting_worksheet/migration.sql). Receiving against
-- an assembly line lands in `finished_goods` (via
-- FinishedGoodsService#receivePurchased), tagged by the new
-- `finished_goods.sourcePurchaseOrderItemId` for traceability back to the
-- PO line — WarehouseStock/StockMovement stay Product-only, unchanged.

ALTER TABLE "purchase_order_items" ADD COLUMN "assemblyId" UUID;
ALTER TABLE "purchase_order_items"
  ADD CONSTRAINT "purchase_order_items_assemblyId_fkey"
  FOREIGN KEY ("assemblyId") REFERENCES "assemblies"("id") ON UPDATE CASCADE ON DELETE SET NULL;
CREATE INDEX "purchase_order_items_assemblyId_idx" ON "purchase_order_items"("assemblyId");
ALTER TABLE "purchase_order_items"
  ADD CONSTRAINT "purchase_order_item_source_consistency" CHECK (
    NOT ("assemblyId" IS NOT NULL AND "productId" IS NOT NULL)
  );

ALTER TABLE "finished_goods" ADD COLUMN "sourcePurchaseOrderItemId" UUID;
ALTER TABLE "finished_goods"
  ADD CONSTRAINT "finished_goods_sourcePurchaseOrderItemId_fkey"
  FOREIGN KEY ("sourcePurchaseOrderItemId") REFERENCES "purchase_order_items"("id") ON UPDATE CASCADE ON DELETE SET NULL;
CREATE INDEX "finished_goods_sourcePurchaseOrderItemId_idx" ON "finished_goods"("sourcePurchaseOrderItemId");
