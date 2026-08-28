-- Two additions (2026-08-28), independent of each other:
--
-- 1. Two new PricingSource values for labor-cost-based quotation pricing
--    (LABOR_MARKUP_PERCENT / LABOR_COST_PLUS_MARGIN) — same markup/margin
--    formulas as the existing MARKUP_PERCENT/COST_PLUS_MARGIN, but keyed off
--    Assembly.laborCostPerUnit instead of the full assembly cost. Plus the
--    matching snapshot column on quotation_version_items.
--
-- 2. company_requisites — a new 1:1-per-company table for legal/contact
--    details (name, tax id, address, bank details, etc.), same shape as
--    company_branding/company_settings.

-- AlterEnum
ALTER TYPE "PricingSource" ADD VALUE 'LABOR_MARKUP_PERCENT';
ALTER TYPE "PricingSource" ADD VALUE 'LABOR_COST_PLUS_MARGIN';

-- AlterTable
ALTER TABLE "quotation_version_items" ADD COLUMN "laborCostSnapshot" DECIMAL(14,2);

-- CreateTable
CREATE TABLE "company_requisites" (
    "companyId" UUID NOT NULL,
    "legalName" TEXT,
    "taxId" TEXT,
    "legalAddress" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "bankName" TEXT,
    "bankIban" TEXT,
    "bankMfo" TEXT,
    "website" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "company_requisites_pkey" PRIMARY KEY ("companyId")
);

-- AddForeignKey
ALTER TABLE "company_requisites" ADD CONSTRAINT "company_requisites_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- Row Level Security — tenant_isolation policy (ADR-0002 pattern,
-- identical to quotations_module's own migration)
-- ---------------------------------------------------------------------

ALTER TABLE company_requisites ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_requisites FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON company_requisites
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

-- ---------------------------------------------------------------------
-- GRANT to app_service (production role) — guarded, see header comment
-- in other migrations for why (local dev/CI have no app_service role)
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_service') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON company_requisites TO app_service';
  END IF;
END
$$;
