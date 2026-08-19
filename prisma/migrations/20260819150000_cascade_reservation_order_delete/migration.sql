-- Migration: cascade_reservation_order_delete
--
-- Real gap found live-testing (2026-08-19, same day as the reservation
-- feature): CustomerOrdersService#remove() (the permanent hard-delete
-- action) never released the order's reservations, and both
-- stock_reservations.customerOrderId and
-- order_material_requirements.customerOrderId were ON DELETE RESTRICT —
-- meaning deleting any customer order that had ever gone through the
-- reservation flow would fail outright with a foreign-key violation. Fixed
-- at the app layer too (CustomerOrdersService#remove now calls
-- releaseAllForOrder before deleting, so WarehouseStock.reservedQty is
-- correctly decremented first), but the FK itself is switched to CASCADE
-- here: both these rows are pure "this much of X is held for order Y"
-- records with no independent meaning once the order is gone (unlike e.g.
-- finished_goods, which stays Restrict — a real physical unit that
-- outlives the order record it was made for).
--
-- Verified via pglast (real libpg_query grammar parsing), not a live
-- database — same standing verification method used for every hand-authored
-- migration in this project (see backend/README.md).

ALTER TABLE "stock_reservations" DROP CONSTRAINT "stock_reservations_companyId_customerOrderId_fkey";
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_companyId_customerOrderId_fkey" FOREIGN KEY ("companyId", "customerOrderId") REFERENCES "customer_orders"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_material_requirements" DROP CONSTRAINT "order_material_requirements_companyId_customerOrderId_fkey";
ALTER TABLE "order_material_requirements" ADD CONSTRAINT "order_material_requirements_companyId_customerOrderId_fkey" FOREIGN KEY ("companyId", "customerOrderId") REFERENCES "customer_orders"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
