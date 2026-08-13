-- План-графік Phase A — additive only. Nothing in this migration drops or
-- alters an existing column/constraint; customer_order_items.productionOrderId
-- stays untouched until a separate, explicitly-confirmed migration.

-- CustomerOrder planning targets
ALTER TABLE "customer_orders"
  ADD COLUMN "plannedStartAt" TIMESTAMPTZ(3),
  ADD COLUMN "plannedCompletionAt" TIMESTAMPTZ(3),
  ADD COLUMN "plannedShipmentAt" TIMESTAMPTZ(3),
  ADD COLUMN "plannedDeliveryAt" TIMESTAMPTZ(3);

-- CustomerOrderItem planning targets
ALTER TABLE "customer_order_items"
  ADD COLUMN "plannedStartAt" TIMESTAMPTZ(3),
  ADD COLUMN "plannedEndAt" TIMESTAMPTZ(3),
  ADD COLUMN "itemDeadline" TIMESTAMPTZ(3);

-- New FK on ProductionOrder — nullable, NOT unique (batch-splitting)
ALTER TABLE "production_orders"
  ADD COLUMN "customerOrderItemId" UUID;
CREATE INDEX "production_orders_companyId_customerOrderItemId_idx"
  ON "production_orders" ("companyId", "customerOrderItemId");
ALTER TABLE "production_orders"
  ADD CONSTRAINT "production_orders_customerOrderItemId_fkey"
  FOREIGN KEY ("customerOrderItemId") REFERENCES "customer_order_items"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ProductionStage composite unique target for the new stage-plan table's FK
ALTER TABLE "production_stages"
  ADD CONSTRAINT "production_stages_companyId_id_key" UNIQUE ("companyId", "id");

-- New table: per-instance stage plan for a specific ProductionOrder batch
CREATE TABLE "production_order_stage_plans" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "productionOrderId" UUID NOT NULL,
  "productionStageId" UUID NOT NULL,
  "plannedStartAt" TIMESTAMPTZ(3),
  "plannedEndAt" TIMESTAMPTZ(3),
  "sortOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "production_order_stage_plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "production_order_stage_plans_productionOrderId_productionSt_key"
  ON "production_order_stage_plans" ("productionOrderId", "productionStageId");
CREATE INDEX "production_order_stage_plans_companyId_productionOrderId_idx"
  ON "production_order_stage_plans" ("companyId", "productionOrderId");

ALTER TABLE "production_order_stage_plans"
  ADD CONSTRAINT "production_order_stage_plans_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_order_stage_plans"
  ADD CONSTRAINT "production_order_stage_plans_companyId_productionOrderId_fkey"
  FOREIGN KEY ("companyId", "productionOrderId") REFERENCES "production_orders"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "production_order_stage_plans"
  ADD CONSTRAINT "production_order_stage_plans_companyId_productionStageId_fkey"
  FOREIGN KEY ("companyId", "productionStageId") REFERENCES "production_stages"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE production_order_stage_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_order_stage_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON production_order_stage_plans
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);
