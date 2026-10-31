-- Irregular-shape (polygon) sheet nesting (2026-11-01) — three new nullable
-- JSONB/Decimal columns, purely additive, no backfill. See schema.prisma's
-- own comments on AssemblyComponent.cutShapePolygon / CuttingPlanCut.
-- shapePolygonCm / CuttingPlanStock.usedAreaCm2/wasteAreaCm2 for the full
-- design rationale.
--
-- Same pre-existing migration-history drift noted in the previous cutting-
-- stock migration (FK drop/recreate on import_connections/import_jobs/
-- landing_page_versions/supplier_portal_*, `id` DEFAULT drops on ~25
-- unrelated tables, a column-type change on users.telegramPairingCodeExpiresAt,
-- four RenameIndex ops) surfaced again on `prisma migrate dev --create-only`
-- and is pruned out here for the same "fix only what this change touches"
-- reason — still unrelated to this change, still a separate future pass.

-- AlterTable
ALTER TABLE "assembly_components" ADD COLUMN "cutShapePolygon" JSONB;

-- AlterTable
ALTER TABLE "cutting_plan_cuts" ADD COLUMN "shapePolygonCm" JSONB;

-- AlterTable
ALTER TABLE "cutting_plan_stocks" ADD COLUMN "usedAreaCm2" DECIMAL(10,2),
ADD COLUMN "wasteAreaCm2" DECIMAL(10,2);
