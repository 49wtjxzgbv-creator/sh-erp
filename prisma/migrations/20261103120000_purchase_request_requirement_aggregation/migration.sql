-- Заявки постачальнику: групування попиту з кількох замовлень клієнтів
-- (2026-11-03) — "це має підтягуватись з продажі і заявки постачальникам".
-- Two additive nullable FKs, no backfill needed (every existing row simply
-- has neither set, same as before this feature existed):
--   * order_material_requirements.fulfillingPurchaseRequestItemId — many
--     requirements (across different customer orders) -> one заявка line.
--   * purchase_order_items.originatingPurchaseRequestItemId — sibling tag
--     stamped on every PurchaseOrderItem produced when convertToOrder fans
--     an aggregated заявка line back out into one PurchaseOrder per
--     distinct customer order.

ALTER TABLE "order_material_requirements" ADD COLUMN "fulfillingPurchaseRequestItemId" UUID;
ALTER TABLE "order_material_requirements"
  ADD CONSTRAINT "order_material_requirements_fulfillingPurchaseRequestItemId_fkey"
  FOREIGN KEY ("fulfillingPurchaseRequestItemId") REFERENCES "purchase_request_items"("id") ON UPDATE CASCADE ON DELETE SET NULL;
CREATE INDEX "order_material_requirements_fulfillingPurchaseRequestItemId_idx" ON "order_material_requirements"("fulfillingPurchaseRequestItemId");

ALTER TABLE "purchase_order_items" ADD COLUMN "originatingPurchaseRequestItemId" UUID;
ALTER TABLE "purchase_order_items"
  ADD CONSTRAINT "purchase_order_items_originatingPurchaseRequestItemId_fkey"
  FOREIGN KEY ("originatingPurchaseRequestItemId") REFERENCES "purchase_request_items"("id") ON UPDATE CASCADE ON DELETE SET NULL;
CREATE INDEX "purchase_order_items_originatingPurchaseRequestItemId_idx" ON "purchase_order_items"("originatingPurchaseRequestItemId");
