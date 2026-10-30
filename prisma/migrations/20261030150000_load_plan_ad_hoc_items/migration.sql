-- AlterTable
-- Ad-hoc load-plan items (2026-10-30) — a load plan line no longer has to
-- come from the customer order: customerOrderItemId/assemblyId become
-- nullable, and new manual* columns describe a fully free-form box when
-- neither FK is set.
ALTER TABLE "load_plan_items" ALTER COLUMN "customerOrderItemId" DROP NOT NULL;
ALTER TABLE "load_plan_items" ALTER COLUMN "assemblyId" DROP NOT NULL;
ALTER TABLE "load_plan_items" ADD COLUMN "manualName" TEXT;
ALTER TABLE "load_plan_items" ADD COLUMN "manualLengthCm" DECIMAL(8,2);
ALTER TABLE "load_plan_items" ADD COLUMN "manualWidthCm" DECIMAL(8,2);
ALTER TABLE "load_plan_items" ADD COLUMN "manualHeightCm" DECIMAL(8,2);
ALTER TABLE "load_plan_items" ADD COLUMN "manualWeightKg" DECIMAL(10,3);
