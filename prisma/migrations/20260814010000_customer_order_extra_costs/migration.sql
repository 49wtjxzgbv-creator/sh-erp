-- Additive only. Extra costs that count toward the customer order total
-- (Продажі — "коли створюємо замовлення"), independent of the BOM-derived
-- line costs.

ALTER TABLE "customer_orders"
  ADD COLUMN "deliveryCost" DECIMAL(14,2),
  ADD COLUMN "transportRiggingCost" DECIMAL(14,2),
  ADD COLUMN "otherCost" DECIMAL(14,2);
