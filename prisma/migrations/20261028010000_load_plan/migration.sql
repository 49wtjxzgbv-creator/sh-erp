-- AlterTable
ALTER TABLE "transport_unit_types" ADD COLUMN     "heightCm" DECIMAL(8,2),
ADD COLUMN     "lengthCm" DECIMAL(8,2),
ADD COLUMN     "widthCm" DECIMAL(8,2);

-- CreateTable
CREATE TABLE "load_plans" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "customerOrderId" UUID NOT NULL,
    "transportUnitTypeId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "load_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "load_plan_trucks" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "loadPlanId" UUID NOT NULL,
    "index" INTEGER NOT NULL,

    CONSTRAINT "load_plan_trucks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "load_plan_items" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "loadPlanTruckId" UUID NOT NULL,
    "customerOrderItemId" UUID NOT NULL,
    "assemblyId" UUID NOT NULL,
    "unitsQty" INTEGER NOT NULL,

    CONSTRAINT "load_plan_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "load_plans_companyId_id_key" ON "load_plans"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "load_plans_companyId_customerOrderId_key" ON "load_plans"("companyId", "customerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "load_plan_trucks_companyId_id_key" ON "load_plan_trucks"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "load_plan_trucks_loadPlanId_index_key" ON "load_plan_trucks"("loadPlanId", "index");

-- CreateIndex
CREATE INDEX "load_plan_items_loadPlanTruckId_idx" ON "load_plan_items"("loadPlanTruckId");

-- CreateIndex
CREATE INDEX "load_plan_items_customerOrderItemId_idx" ON "load_plan_items"("customerOrderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "load_plan_items_companyId_id_key" ON "load_plan_items"("companyId", "id");

-- AddForeignKey
ALTER TABLE "load_plans" ADD CONSTRAINT "load_plans_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_plans" ADD CONSTRAINT "load_plans_companyId_customerOrderId_fkey" FOREIGN KEY ("companyId", "customerOrderId") REFERENCES "customer_orders"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_plans" ADD CONSTRAINT "load_plans_companyId_transportUnitTypeId_fkey" FOREIGN KEY ("companyId", "transportUnitTypeId") REFERENCES "transport_unit_types"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_plan_trucks" ADD CONSTRAINT "load_plan_trucks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_plan_trucks" ADD CONSTRAINT "load_plan_trucks_companyId_loadPlanId_fkey" FOREIGN KEY ("companyId", "loadPlanId") REFERENCES "load_plans"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_plan_items" ADD CONSTRAINT "load_plan_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_plan_items" ADD CONSTRAINT "load_plan_items_companyId_loadPlanTruckId_fkey" FOREIGN KEY ("companyId", "loadPlanTruckId") REFERENCES "load_plan_trucks"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_plan_items" ADD CONSTRAINT "load_plan_items_companyId_customerOrderItemId_fkey" FOREIGN KEY ("companyId", "customerOrderItemId") REFERENCES "customer_order_items"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_plan_items" ADD CONSTRAINT "load_plan_items_companyId_assemblyId_fkey" FOREIGN KEY ("companyId", "assemblyId") REFERENCES "assemblies"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- Row Level Security — tenant_isolation policy (ADR-0002 pattern,
-- identical to every other new company-scoped table, e.g.
-- 20261028000000_shipment_packaging_and_transport_types's own migration).
-- ---------------------------------------------------------------------

ALTER TABLE load_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE load_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON load_plans
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE load_plan_trucks ENABLE ROW LEVEL SECURITY;
ALTER TABLE load_plan_trucks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON load_plan_trucks
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE load_plan_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE load_plan_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON load_plan_items
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

-- ---------------------------------------------------------------------
-- GRANT to app_service (production role) — guarded, local dev/CI have
-- no app_service role at all.
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_service') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON load_plans TO app_service';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON load_plan_trucks TO app_service';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON load_plan_items TO app_service';
  END IF;
END
$$;
