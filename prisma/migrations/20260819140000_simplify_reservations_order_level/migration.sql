-- Migration: simplify_reservations_order_level
--
-- Simplification pass (2026-08-19, same day as the original stock-
-- reservation feature): reservations move from per ORDER LINE to per
-- ORDER — matching the shortage engine's own long-standing "whole order is
-- one shared pool per product" design (see customer-order-shortage.service.ts's
-- header comment), and matching the simplified UI, which now lives on the
-- existing "Аналіз дефіциту" (shortage analysis) page instead of a separate
-- per-line card. `order_material_requirements` also gains `requiredQty`, a
-- snapshot locked at order-creation time (same philosophy as
-- ProductionOrder.assemblyVersionId), needed so the new warehouse-wide
-- "Не вистачає для резервації" aggregate can be one indexed SUM instead of
-- re-walking every active order's BOM tree on every page load.
--
-- Both tables were created earlier TODAY (20260819130000) with no real
-- committed production data (the only row created during manual testing
-- was already released back to zero before this migration was written) —
-- safe to alter destructively rather than write a data-preserving backfill.
--
-- Verified via pglast (real libpg_query grammar parsing), not a live
-- database — same standing verification method used for every hand-authored
-- migration in this project (see backend/README.md).

-- stock_reservations: drop the per-item identity, move to per-order
ALTER TABLE "stock_reservations" DROP CONSTRAINT "stock_reservations_companyId_customerOrderItemId_fkey";
DROP INDEX "stock_reservations_itemId_productId_warehouseId_source_key";
DROP INDEX "stock_reservations_companyId_customerOrderItemId_idx";
ALTER TABLE "stock_reservations" DROP COLUMN "customerOrderItemId";
CREATE UNIQUE INDEX "stock_reservations_orderId_productId_warehouseId_source_key" ON "stock_reservations"("customerOrderId", "productId", "warehouseId", "source");

-- order_material_requirements: drop the per-item identity, move to per-order, add requiredQty
ALTER TABLE "order_material_requirements" DROP CONSTRAINT "order_material_requirements_companyId_customerOrderItemId_fkey";
DROP INDEX "order_material_requirements_customerOrderItemId_productId_key";
ALTER TABLE "order_material_requirements" DROP COLUMN "customerOrderItemId";
ALTER TABLE "order_material_requirements" ADD COLUMN "requiredQty" DECIMAL(14,3) NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "order_material_requirements_customerOrderId_productId_key" ON "order_material_requirements"("customerOrderId", "productId");

-- customer_order_items: the composite-FK target added for the per-item
-- design is no longer referenced by anything — drop it rather than leave
-- dead schema.
DROP INDEX "customer_order_items_companyId_id_key";
