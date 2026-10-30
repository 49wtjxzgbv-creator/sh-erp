-- AlterTable
-- Load-plan weight-aware stacking (2026-10-30) — lets LoadPlanService know
-- what may be placed on top of an assembly's own box when packing a truck.
ALTER TABLE "assemblies" ADD COLUMN "boxStackable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "assemblies" ADD COLUMN "boxMaxStackWeightKg" DECIMAL(10,2);
