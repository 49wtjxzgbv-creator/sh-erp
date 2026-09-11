-- Additive only. Total price the whole order is sold to the customer for —
-- entered directly by staff, independent of the BOM-derived cost totals
-- (estimatedTotal/actualTotal).

ALTER TABLE "customer_orders"
  ADD COLUMN "salePrice" DECIMAL(14,2);
