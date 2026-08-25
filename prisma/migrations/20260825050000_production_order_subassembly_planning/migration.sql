-- Sub-assembly batch planning (2026-08-25 user request): when a sales
-- order line's assembly needs sub-assemblies (recursively, at any BOM
-- depth), staff can now choose per sub-assembly to plan a production batch
-- for it immediately, instead of implicitly relying on whatever's already
-- IN_STOCK once the parent assembly starts. Deliberately a NEW column, not
-- a reuse of "customerOrderItemId" — CustomerOrdersService's quantity/cost
-- rollups (getItemQuantitySummary, withPriceTotals) key strictly off
-- customerOrderItemId, so reusing it here would silently double-count a
-- sub-assembly batch's units/cost against the parent item's own progress.

ALTER TABLE "production_orders" ADD COLUMN "subAssemblyForItemId" UUID;

ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_subAssemblyForItemId_fkey"
  FOREIGN KEY ("subAssemblyForItemId") REFERENCES "customer_order_items"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "production_orders_companyId_subAssemblyForItemId_idx"
  ON "production_orders"("companyId", "subAssemblyForItemId");
