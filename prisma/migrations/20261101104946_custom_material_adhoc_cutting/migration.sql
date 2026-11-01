-- Custom (catalog-free) material in the ad-hoc cutting worksheet, 2026-11-01.
--
-- Hand-curated: `prisma migrate dev --create-only` also surfaced the same
-- class of pre-existing, unrelated migration-history drift already flagged
-- and pruned in every cutting-module migration this cycle (FK drop/recreate
-- on import_connections/import_jobs/landing_page_versions/super_admin_*/
-- supplier_portal_*, `id` DEFAULT drops on ~25 unrelated tables, a column-
-- type change on users.telegramPairingCodeExpiresAt, and four RenameIndex
-- ops). Pruned here too; out of scope for this change.

-- AlterTable: a worksheet position's material no longer requires a catalog
-- product — productId becomes optional, customMaterialLabel carries the
-- typed-in name for a material with no product behind it. Exactly one of
-- the two is set per row (enforced in CuttingPlansService#preview, not a
-- DB constraint — mirrors the existing assemblyId/productId pattern on
-- CuttingPlan, which is enforced the same two-layer way).
ALTER TABLE "cutting_plan_stocks" ADD COLUMN "customMaterialLabel" TEXT,
ALTER COLUMN "productId" DROP NOT NULL;

-- AlterTable: mirrors its owning stock row — null for a custom material.
ALTER TABLE "cutting_plan_cuts" ALTER COLUMN "productId" DROP NOT NULL;
