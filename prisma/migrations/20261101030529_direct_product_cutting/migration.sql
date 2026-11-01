-- Direct-product cutting (розкрій without a specification), 2026-11-01.
--
-- Hand-curated: `prisma migrate dev --create-only` also surfaced a batch of
-- pre-existing, unrelated migration-history drift (FK drop/recreate on
-- import_connections/import_jobs/landing_page_versions/super_admin_*/
-- supplier_portal_*, `id` DEFAULT drops on ~25 unrelated tables, a column-
-- type change on users.telegramPairingCodeExpiresAt, and four RenameIndex
-- ops) — same drift class already flagged and pruned in the two prior
-- cutting-module migrations. Pruned here too; out of scope for this change.

-- AlterTable: ProductCuttingSpec gains the product's own default piece-to-
-- cut shape (used when "Порахувати розкрій" is run directly against a
-- product, no assembly involved).
ALTER TABLE "product_cutting_specs" ADD COLUMN "defaultCutLengthCm" DECIMAL(8,2),
ADD COLUMN "defaultCutWidthCm" DECIMAL(8,2),
ADD COLUMN "defaultCutShapePolygon" JSONB;

-- AlterTable: CuttingPlan can now be sourced from either an assembly (BOM
-- walk, existing behavior) or a single product directly (new).
ALTER TABLE "cutting_plans" ALTER COLUMN "assemblyId" DROP NOT NULL,
ADD COLUMN "productId" UUID;

-- CreateIndex
CREATE INDEX "cutting_plans_companyId_productId_idx" ON "cutting_plans"("companyId", "productId");

-- AddForeignKey
ALTER TABLE "cutting_plans" ADD CONSTRAINT "cutting_plans_companyId_productId_fkey" FOREIGN KEY ("companyId", "productId") REFERENCES "products"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Exactly one of assemblyId/productId must be set — same two-layer pattern
-- (DB CHECK + application-level validation in CuttingPlansService#preview)
-- as the existing assembly_component_type_consistency constraint.
ALTER TABLE "cutting_plans" ADD CONSTRAINT "cutting_plan_source_consistency" CHECK (
  ("assemblyId" IS NOT NULL AND "productId" IS NULL) OR
  ("assemblyId" IS NULL AND "productId" IS NOT NULL)
);
