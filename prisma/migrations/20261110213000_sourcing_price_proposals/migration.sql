-- "правка ціни щоб було тільки через підтвердження в основній erp"
-- (2026-11-10). The Mini App can only CREATE a row here — it never writes
-- product_suppliers.price directly; a human confirms/rejects in the main
-- ERP. Purely additive.

-- CreateEnum
CREATE TYPE "SourcingPriceProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "sourcing_price_proposals" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "proposedPriceEur" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "status" "SourcingPriceProposalStatus" NOT NULL DEFAULT 'PENDING',
    "proposedByUserId" UUID NOT NULL,
    "reviewedByUserId" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sourcing_price_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sourcing_price_proposals_companyId_status_idx" ON "sourcing_price_proposals"("companyId", "status");

-- CreateIndex
CREATE INDEX "sourcing_price_proposals_companyId_productId_idx" ON "sourcing_price_proposals"("companyId", "productId");

-- AddForeignKey
ALTER TABLE "sourcing_price_proposals" ADD CONSTRAINT "sourcing_price_proposals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourcing_price_proposals" ADD CONSTRAINT "sourcing_price_proposals_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sourcing_price_proposals" ADD CONSTRAINT "sourcing_price_proposals_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- Row Level Security — tenant_isolation policy (ADR-0002 pattern,
-- identical to every other company-scoped sourcing-bot table).
-- ---------------------------------------------------------------------

ALTER TABLE sourcing_price_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE sourcing_price_proposals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sourcing_price_proposals
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

-- ---------------------------------------------------------------------
-- GRANT to app_service (production role) — guarded, local dev/CI have
-- no app_service role at all. Both the Mini App (create-only) and the
-- main ERP (review/approve/reject) go through this same tenant-scoped
-- connection, same as every other sourcing-bot table.
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_service') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON sourcing_price_proposals TO app_service';
  END IF;
END
$$;
