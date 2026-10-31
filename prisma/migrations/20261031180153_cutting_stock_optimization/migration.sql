-- Cutting-stock optimization (розкрій, 2026-10-31) — ProductCuttingSpec,
-- StockRemnant, CuttingPlan, CuttingPlanStock, CuttingPlanCut, plus two new
-- nullable columns on AssemblyComponent (cutLengthCm/cutWidthCm). See
-- schema.prisma's own "SECTION: Cutting-stock optimization" header comment
-- for the full design rationale (remnants are a planning layer on top of
-- WarehouseStock.qty, never a second ledger).
--
-- Purely additive — five new tables, four new enums, two new nullable
-- columns on an existing table. No existing row is touched, no backfill.
--
-- NOTE: `prisma migrate dev --create-only` against this schema also
-- surfaced a batch of pre-existing drift between migration history and
-- schema.prisma unrelated to this feature (FK drop/recreate on
-- import_connections/import_jobs/landing_page_versions/supplier_portal_*,
-- `id` DEFAULT drops on ~25 unrelated tables, a column-type change on
-- `users.telegramPairingCodeExpiresAt`, four RenameIndex ops). None of that
-- is included here — pruned out as out of scope for this change, same
-- "fix only what this change touches" discipline as every other migration
-- in this history. Flagging for a future, separate pass.
--
-- Verified against an isolated local Postgres 16 instance with real RLS
-- (non-superuser app_service role, FORCE ROW LEVEL SECURITY, two-company
-- cross-tenant isolation check) before trusting this for production.

-- CreateEnum
CREATE TYPE "CuttingStockKind" AS ENUM ('BAR', 'SHEET');

-- CreateEnum
CREATE TYPE "RemnantStatus" AS ENUM ('AVAILABLE', 'CONSUMED');

-- CreateEnum
CREATE TYPE "CuttingPlanStatus" AS ENUM ('DRAFT', 'EXECUTED');

-- CreateEnum
CREATE TYPE "CuttingPlanStockSourceKind" AS ENUM ('FRESH', 'REMNANT');

-- AlterTable
ALTER TABLE "assembly_components" ADD COLUMN "cutLengthCm" DECIMAL(8,2),
ADD COLUMN "cutWidthCm" DECIMAL(8,2);

-- CreateTable
CREATE TABLE "product_cutting_specs" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "kind" "CuttingStockKind" NOT NULL,
    "stockLengthCm" DECIMAL(8,2) NOT NULL,
    "stockWidthCm" DECIMAL(8,2),
    "kerfMm" DECIMAL(6,2) NOT NULL DEFAULT 3,
    "minRemnantLengthCm" DECIMAL(8,2),
    "minRemnantAreaCm2" DECIMAL(10,2),
    "allowRotation" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_cutting_specs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_remnants" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "kind" "CuttingStockKind" NOT NULL,
    "lengthCm" DECIMAL(8,2) NOT NULL,
    "widthCm" DECIMAL(8,2),
    "code" TEXT NOT NULL,
    "status" "RemnantStatus" NOT NULL DEFAULT 'AVAILABLE',
    "sourceType" TEXT,
    "sourceId" UUID,
    "consumedInCuttingPlanId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMPTZ(3),

    CONSTRAINT "stock_remnants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cutting_plans" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "assemblyId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "status" "CuttingPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" TIMESTAMPTZ(3),

    CONSTRAINT "cutting_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cutting_plan_stocks" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "cuttingPlanId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "sourceKind" "CuttingPlanStockSourceKind" NOT NULL,
    "remnantId" UUID,
    "lengthCm" DECIMAL(8,2) NOT NULL,
    "widthCm" DECIMAL(8,2),
    "leftoverLengthCm" DECIMAL(8,2),
    "leftoverWidthCm" DECIMAL(8,2),
    "newRemnantId" UUID,

    CONSTRAINT "cutting_plan_stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cutting_plan_cuts" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "cuttingPlanStockId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "pieceLengthCm" DECIMAL(8,2) NOT NULL,
    "pieceWidthCm" DECIMAL(8,2),
    "posXCm" DECIMAL(8,2),
    "posYCm" DECIMAL(8,2),
    "rotated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "cutting_plan_cuts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_cutting_specs_companyId_idx" ON "product_cutting_specs"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "product_cutting_specs_companyId_productId_key" ON "product_cutting_specs"("companyId", "productId");

-- CreateIndex
CREATE INDEX "stock_remnants_companyId_productId_status_idx" ON "stock_remnants"("companyId", "productId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_remnants_companyId_code_key" ON "stock_remnants"("companyId", "code");

-- CreateIndex
CREATE INDEX "cutting_plans_companyId_assemblyId_idx" ON "cutting_plans"("companyId", "assemblyId");

-- CreateIndex
CREATE UNIQUE INDEX "cutting_plans_companyId_id_key" ON "cutting_plans"("companyId", "id");

-- CreateIndex
CREATE INDEX "cutting_plan_stocks_cuttingPlanId_idx" ON "cutting_plan_stocks"("cuttingPlanId");

-- CreateIndex
CREATE INDEX "cutting_plan_stocks_companyId_idx" ON "cutting_plan_stocks"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "cutting_plan_stocks_companyId_id_key" ON "cutting_plan_stocks"("companyId", "id");

-- CreateIndex
CREATE INDEX "cutting_plan_cuts_cuttingPlanStockId_idx" ON "cutting_plan_cuts"("cuttingPlanStockId");

-- CreateIndex
CREATE INDEX "cutting_plan_cuts_companyId_idx" ON "cutting_plan_cuts"("companyId");

-- AddForeignKey
ALTER TABLE "product_cutting_specs" ADD CONSTRAINT "product_cutting_specs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_cutting_specs" ADD CONSTRAINT "product_cutting_specs_companyId_productId_fkey" FOREIGN KEY ("companyId", "productId") REFERENCES "products"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_remnants" ADD CONSTRAINT "stock_remnants_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_remnants" ADD CONSTRAINT "stock_remnants_companyId_productId_fkey" FOREIGN KEY ("companyId", "productId") REFERENCES "products"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_remnants" ADD CONSTRAINT "stock_remnants_companyId_warehouseId_fkey" FOREIGN KEY ("companyId", "warehouseId") REFERENCES "warehouses"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_plans" ADD CONSTRAINT "cutting_plans_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_plans" ADD CONSTRAINT "cutting_plans_companyId_assemblyId_fkey" FOREIGN KEY ("companyId", "assemblyId") REFERENCES "assemblies"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_plans" ADD CONSTRAINT "cutting_plans_companyId_warehouseId_fkey" FOREIGN KEY ("companyId", "warehouseId") REFERENCES "warehouses"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_plan_stocks" ADD CONSTRAINT "cutting_plan_stocks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_plan_stocks" ADD CONSTRAINT "cutting_plan_stocks_companyId_cuttingPlanId_fkey" FOREIGN KEY ("companyId", "cuttingPlanId") REFERENCES "cutting_plans"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_plan_stocks" ADD CONSTRAINT "cutting_plan_stocks_companyId_productId_fkey" FOREIGN KEY ("companyId", "productId") REFERENCES "products"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_plan_cuts" ADD CONSTRAINT "cutting_plan_cuts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_plan_cuts" ADD CONSTRAINT "cutting_plan_cuts_companyId_cuttingPlanStockId_fkey" FOREIGN KEY ("companyId", "cuttingPlanStockId") REFERENCES "cutting_plan_stocks"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_plan_cuts" ADD CONSTRAINT "cutting_plan_cuts_companyId_productId_fkey" FOREIGN KEY ("companyId", "productId") REFERENCES "products"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- Row Level Security — tenant_isolation policy (ADR-0002 pattern,
-- identical to every other new company-scoped table).
-- ---------------------------------------------------------------------

ALTER TABLE product_cutting_specs ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_cutting_specs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON product_cutting_specs
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE stock_remnants ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_remnants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_remnants
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE cutting_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE cutting_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cutting_plans
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE cutting_plan_stocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE cutting_plan_stocks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cutting_plan_stocks
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE cutting_plan_cuts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cutting_plan_cuts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cutting_plan_cuts
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

-- ---------------------------------------------------------------------
-- GRANT to app_service (production role) — guarded, local dev/CI have
-- no app_service role at all. See purchase_order_finance migration's
-- header comment for the full privilege-model rationale (prod also has
-- a standing schema-wide ALTER DEFAULT PRIVILEGES to app_service that
-- would likely cover these tables too, but this explicit grant stays as
-- the correct, self-contained guarantee rather than depending on that
-- undocumented production-only state).
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_service') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON product_cutting_specs TO app_service';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON stock_remnants TO app_service';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON cutting_plans TO app_service';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON cutting_plan_stocks TO app_service';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON cutting_plan_cuts TO app_service';
  END IF;
END
$$;
