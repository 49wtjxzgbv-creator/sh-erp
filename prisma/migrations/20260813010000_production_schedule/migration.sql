-- Migration: production_schedule
--
-- Adds ProductionOrder.scheduledStartAt/scheduledEndAt (optional target
-- window for the year-schedule view — nullable, existing orders never had
-- one; the schedule query falls back to createdAt/completedAt for those)
-- and ProductionScheduleSlot (forward-planning: reserves a slot on the
-- schedule before a real ProductionOrder exists, e.g. "week of March 10,
-- ~50 units, likely Client X" — see the model's own header comment in
-- schema.prisma). New tenant table + RLS in one migration, same precedent
-- as 20260807000000_add_import_job and 20260813000000_supplier_portal:
-- regular app_user/RLS-scoped access, nothing new at the DB-role level.
--
-- Verified via pglast (real libpg_query grammar parsing), not a live
-- database — same standing verification method used for every hand-authored
-- migration in this project (see backend/README.md).

-- AlterTable
ALTER TABLE "production_orders"
  ADD COLUMN "scheduledStartAt" TIMESTAMPTZ(3),
  ADD COLUMN "scheduledEndAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "production_schedule_slots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "assemblyId" UUID,
    "title" TEXT NOT NULL,
    "plannedUnits" DECIMAL(14,3),
    "startAt" TIMESTAMPTZ(3) NOT NULL,
    "endAt" TIMESTAMPTZ(3) NOT NULL,
    "comment" TEXT,
    "convertedToProductionOrderId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "production_schedule_slots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "production_schedule_slots_convertedToProductionOrderId_key" ON "production_schedule_slots"("convertedToProductionOrderId");
CREATE INDEX "production_schedule_slots_companyId_startAt_idx" ON "production_schedule_slots"("companyId", "startAt");

ALTER TABLE "production_schedule_slots" ADD CONSTRAINT "production_schedule_slots_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_schedule_slots" ADD CONSTRAINT "production_schedule_slots_assemblyId_fkey" FOREIGN KEY ("assemblyId") REFERENCES "assemblies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "production_schedule_slots" ADD CONSTRAINT "production_schedule_slots_convertedToProductionOrderId_fkey" FOREIGN KEY ("convertedToProductionOrderId") REFERENCES "production_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE production_schedule_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_schedule_slots FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON production_schedule_slots
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);
