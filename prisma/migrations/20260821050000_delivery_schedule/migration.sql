-- Migration: delivery_schedule (Phase 1, 2026-08-21)
--
-- Versioned, multi-date delivery plan per PurchaseOrderItem — additive to
-- (never replacing) the existing order-level `PurchaseOrder.supplierConfirmedAt`
-- / `supplierConfirmedDeliveryDate` / `PurchaseOrderItem.supplierConfirmedPrice`
-- mechanism, which remains the source of truth for any item that never gets
-- a DeliverySchedule at all. Purely additive: two new tables, one new enum,
-- one new NULLABLE column on the existing `purchase_order_items` table — no
-- existing row is touched, no backfill, no existing order/item behavior
-- changes unless someone explicitly creates a schedule for it going forward.
--
-- Exactly one `DeliverySchedule` version is ever "current" for a given item
-- (`purchase_order_items.currentDeliveryScheduleId`), moved only via an
-- atomic conditional update in application code (never a bare write) — see
-- DeliverySchedulesService. A PROPOSED (supplier counter-proposal) version
-- exists ALONGSIDE the current one without replacing it; at most one
-- PROPOSED version may exist per item at a time, enforced here at the
-- database level (partial unique index below), not just in application code.
--
-- Circular FK, deliberate and checked: `delivery_schedules.purchaseOrderItemId`
-- -> `purchase_order_items` (CASCADE) and `purchase_order_items.currentDeliveryScheduleId`
-- -> `delivery_schedules` (the reverse pointer) together form a two-table
-- cycle. The existing `DELETE /purchase-orders/:id` hard-deletes cascade
-- into `purchase_order_items`, which would need to cascade into
-- `delivery_schedules` too — if the reverse pointer's FK were left at the
-- default RESTRICT, that cascade would conflict with the still-present
-- pointer on the very row being deleted. Fixed with `ON DELETE SET NULL` on
-- the reverse pointer (below): Postgres nulls it first, then the cascade
-- completes cleanly, no same-statement conflict between the two opposite
-- constraints.
--
-- Verified via pglast (real libpg_query grammar parsing), not a live
-- database — same standing verification method used for every hand-
-- authored migration in this project.

-- ---------------------------------------------------------------------------
-- New enum + tables
-- ---------------------------------------------------------------------------

CREATE TYPE "DeliveryScheduleStatus" AS ENUM ('PENDING', 'PROPOSED', 'CONFIRMED', 'REJECTED', 'SUPERSEDED');

CREATE TABLE "delivery_schedules" (
    "id"                  UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId"           UUID NOT NULL,
    "purchaseOrderItemId" UUID NOT NULL,
    "versionNumber"       INTEGER NOT NULL,
    "status"              "DeliveryScheduleStatus" NOT NULL DEFAULT 'PENDING',
    "previousVersionId"   UUID,
    "createdById"         UUID NOT NULL,
    "createdAt"           TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedById"       UUID,
    "respondedAt"         TIMESTAMPTZ(3),

    CONSTRAINT "delivery_schedules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "delivery_schedules_purchaseOrderItemId_versionNumber_key" ON "delivery_schedules"("purchaseOrderItemId", "versionNumber");
CREATE INDEX "delivery_schedules_companyId_idx" ON "delivery_schedules"("companyId");

-- The one-PROPOSED-at-a-time guarantee — a real database constraint, not
-- just an application-layer check: two concurrent `propose()` calls for the
-- same item can never both succeed, the second always hits this index.
CREATE UNIQUE INDEX "delivery_schedules_one_proposed_per_item"
  ON "delivery_schedules" ("purchaseOrderItemId") WHERE "status" = 'PROPOSED';

ALTER TABLE "delivery_schedules" ADD CONSTRAINT "delivery_schedules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_schedules" ADD CONSTRAINT "delivery_schedules_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "purchase_order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "delivery_schedules" ADD CONSTRAINT "delivery_schedules_previousVersionId_fkey" FOREIGN KEY ("previousVersionId") REFERENCES "delivery_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE delivery_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_schedules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON delivery_schedules
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

CREATE TABLE "delivery_schedule_lines" (
    "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId"          UUID NOT NULL,
    "deliveryScheduleId" UUID NOT NULL,
    "date"               TIMESTAMPTZ(3) NOT NULL,
    "qty"                DECIMAL(14, 3) NOT NULL,
    "createdAt"          TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_schedule_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "delivery_schedule_lines_deliveryScheduleId_idx" ON "delivery_schedule_lines"("deliveryScheduleId");
CREATE INDEX "delivery_schedule_lines_companyId_idx" ON "delivery_schedule_lines"("companyId");

ALTER TABLE "delivery_schedule_lines" ADD CONSTRAINT "delivery_schedule_lines_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_schedule_lines" ADD CONSTRAINT "delivery_schedule_lines_deliveryScheduleId_fkey" FOREIGN KEY ("deliveryScheduleId") REFERENCES "delivery_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE delivery_schedule_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_schedule_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON delivery_schedule_lines
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

-- ---------------------------------------------------------------------------
-- Reverse pointer on the existing table — added AFTER delivery_schedules
-- exists, per the circular-FK ordering explained above. ON DELETE SET NULL
-- is what actually breaks the cycle safely (see header comment).
-- ---------------------------------------------------------------------------

ALTER TABLE "purchase_order_items" ADD COLUMN "currentDeliveryScheduleId" UUID;
CREATE INDEX "purchase_order_items_currentDeliveryScheduleId_idx" ON "purchase_order_items"("currentDeliveryScheduleId");
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_currentDeliveryScheduleId_fkey" FOREIGN KEY ("currentDeliveryScheduleId") REFERENCES "delivery_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
