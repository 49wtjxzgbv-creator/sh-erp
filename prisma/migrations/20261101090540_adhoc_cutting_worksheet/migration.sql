-- Ad-hoc multi-material cutting worksheet, 2026-11-01.
--
-- Hand-curated: `prisma migrate dev --create-only` also surfaced the same
-- class of pre-existing, unrelated migration-history drift already flagged
-- and pruned in every prior cutting-module migration this cycle (FK
-- drop/recreate on import_connections/import_jobs/landing_page_versions/
-- super_admin_*/supplier_portal_*, `id` DEFAULT drops on ~25 unrelated
-- tables, a column-type change on users.telegramPairingCodeExpiresAt, and
-- four RenameIndex ops). Pruned here too; out of scope for this change.

-- AlterTable: the ad-hoc line's own free-text label, recovered at
-- persistence time for display on the plan's cut diagrams.
ALTER TABLE "cutting_plan_cuts" ADD COLUMN "pieceLabel" TEXT;

-- Relax CuttingPlan's source-consistency CHECK from "exactly one of
-- assemblyId/productId" to "at most one" — both null now means an ad-hoc
-- worksheet plan (demand lines supplied directly in the preview request,
-- never persisted as their own rows).
ALTER TABLE "cutting_plans" DROP CONSTRAINT "cutting_plan_source_consistency";
ALTER TABLE "cutting_plans" ADD CONSTRAINT "cutting_plan_source_consistency" CHECK (
  NOT ("assemblyId" IS NOT NULL AND "productId" IS NOT NULL)
);
