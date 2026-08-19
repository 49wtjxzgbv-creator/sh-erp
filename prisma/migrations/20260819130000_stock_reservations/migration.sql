-- Migration: stock_reservations
--
-- Full stock reservation/allocation system (2026-08-19 spec): a customer
-- order line can explicitly split its material need between existing stock
-- (reserved, not written off) and new purchases (auto-reserved on receipt,
-- capped to the outstanding uncovered need). See:
--   - WarehouseStock.reservedQty (added here) — denormalized running total
--     of active reservations against a (product, warehouse), same
--     atomic-increment pattern as WarehouseStock.qty/Product.qty, needed so
--     "never let total reservations exceed physical stock" can be enforced
--     with one conditional atomic UPDATE under concurrency
--     (StockReservationService#reserve).
--   - stock_reservations — the reservation "hold" entity (one row per
--     customerOrderItem × product × warehouse × source), mutable-status
--     like purchase_orders/production_orders, not an immutable ledger.
--   - order_material_requirements — persists only the human's chosen split
--     (qtyFromStock/qtyToPurchase) per (customerOrderItem × product);
--     everything else (physical/reserved/available/ordered/received/issued)
--     is computed live, per this app's existing "compute summaries
--     server-side, don't store derived values" convention.
--   - purchase_order_items.sourceRequirementId — optional link so receiving
--     a purchase line can auto-reserve for the customer order it was bought
--     for.
--
-- Verified via pglast (real libpg_query grammar parsing), not a live
-- database — same standing verification method used for every hand-authored
-- migration in this project (see backend/README.md).

-- CreateEnum
CREATE TYPE "StockReservationSource" AS ENUM ('STOCK', 'PURCHASE');

-- AlterTable: WarehouseStock.reservedQty
ALTER TABLE "warehouse_stock" ADD COLUMN "reservedQty" DECIMAL(14,3) NOT NULL DEFAULT 0;

-- AlterTable: PurchaseOrderItem.sourceRequirementId
ALTER TABLE "purchase_order_items" ADD COLUMN "sourceRequirementId" UUID;

-- CreateTable: customer_order_items composite-FK target (companyId, id) —
-- needed so stock_reservations/order_material_requirements can reference it
-- via composite FK (decision 4, schema.prisma header).
CREATE UNIQUE INDEX "customer_order_items_companyId_id_key" ON "customer_order_items"("companyId", "id");

-- CreateTable
CREATE TABLE "order_material_requirements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "customerOrderId" UUID NOT NULL,
    "customerOrderItemId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "qtyFromStock" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "qtyToPurchase" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "order_material_requirements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "order_material_requirements_customerOrderItemId_productId_key" ON "order_material_requirements"("customerOrderItemId", "productId");
CREATE INDEX "order_material_requirements_companyId_customerOrderId_idx" ON "order_material_requirements"("companyId", "customerOrderId");

ALTER TABLE "order_material_requirements" ADD CONSTRAINT "order_material_requirements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_material_requirements" ADD CONSTRAINT "order_material_requirements_companyId_customerOrderId_fkey" FOREIGN KEY ("companyId", "customerOrderId") REFERENCES "customer_orders"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_material_requirements" ADD CONSTRAINT "order_material_requirements_companyId_customerOrderItemId_fkey" FOREIGN KEY ("companyId", "customerOrderItemId") REFERENCES "customer_order_items"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_material_requirements" ADD CONSTRAINT "order_material_requirements_companyId_productId_fkey" FOREIGN KEY ("companyId", "productId") REFERENCES "products"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE order_material_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_material_requirements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON order_material_requirements
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "customerOrderId" UUID NOT NULL,
    "customerOrderItemId" UUID NOT NULL,
    "source" "StockReservationSource" NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "consumedQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "releasedQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_reservations_itemId_productId_warehouseId_source_key" ON "stock_reservations"("customerOrderItemId", "productId", "warehouseId", "source");
CREATE INDEX "stock_reservations_companyId_productId_warehouseId_idx" ON "stock_reservations"("companyId", "productId", "warehouseId");
CREATE INDEX "stock_reservations_companyId_customerOrderId_idx" ON "stock_reservations"("companyId", "customerOrderId");
CREATE INDEX "stock_reservations_companyId_customerOrderItemId_idx" ON "stock_reservations"("companyId", "customerOrderItemId");

ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_companyId_productId_fkey" FOREIGN KEY ("companyId", "productId") REFERENCES "products"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_companyId_warehouseId_fkey" FOREIGN KEY ("companyId", "warehouseId") REFERENCES "warehouses"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_companyId_productId_warehouseId_fkey" FOREIGN KEY ("companyId", "productId", "warehouseId") REFERENCES "warehouse_stock"("companyId", "productId", "warehouseId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_companyId_customerOrderId_fkey" FOREIGN KEY ("companyId", "customerOrderId") REFERENCES "customer_orders"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_companyId_customerOrderItemId_fkey" FOREIGN KEY ("companyId", "customerOrderItemId") REFERENCES "customer_order_items"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE stock_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_reservations
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

-- AddForeignKey: purchase_order_items.sourceRequirementId (single-column FK
-- — see schema.prisma header §cross-tenant, optional relation)
CREATE INDEX "purchase_order_items_sourceRequirementId_idx" ON "purchase_order_items"("sourceRequirementId");
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_sourceRequirementId_fkey" FOREIGN KEY ("sourceRequirementId") REFERENCES "order_material_requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
