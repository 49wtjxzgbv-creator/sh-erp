-- Заявка на прорахунок постачальнику (2026-10-21): a non-committal,
-- single-supplier quote request, deliberately a SEPARATE table from
-- purchase_orders — finance.service.ts and dashboard-timeline.service.ts
-- both read every PurchaseOrder row with no status filter at all, so a
-- draft/RFQ row sharing that table would silently leak into spend totals
-- and the delivery timeline. See the model's own schema.prisma comment.

-- CreateEnum
CREATE TYPE "PurchaseRequestStatus" AS ENUM ('DRAFT', 'SENT', 'CONVERTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "purchase_requests" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" UUID,
    "supplierNameSnapshot" TEXT NOT NULL,
    "status" "PurchaseRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "comment" TEXT,
    "convertedPurchaseOrderId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ(3),

    CONSTRAINT "purchase_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_request_items" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "purchaseRequestId" UUID NOT NULL,
    "productId" UUID,
    "articleSnapshot" TEXT NOT NULL,
    "productNameSnapshot" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "expectedPrice" DECIMAL(14,2),

    CONSTRAINT "purchase_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_requests_companyId_status_idx" ON "purchase_requests"("companyId", "status");
CREATE UNIQUE INDEX "purchase_requests_companyId_id_key" ON "purchase_requests"("companyId", "id");
CREATE UNIQUE INDEX "purchase_requests_companyId_number_key" ON "purchase_requests"("companyId", "number");

CREATE INDEX "purchase_request_items_purchaseRequestId_idx" ON "purchase_request_items"("purchaseRequestId");
CREATE INDEX "purchase_request_items_companyId_idx" ON "purchase_request_items"("companyId");

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_companyId_purchaseRequestId_fkey" FOREIGN KEY ("companyId", "purchaseRequestId") REFERENCES "purchase_requests"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- Row Level Security — tenant_isolation policy on every new table
-- (ADR-0002 pattern, identical to quotations_module's own migration).
-- ---------------------------------------------------------------------

ALTER TABLE purchase_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_requests
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE purchase_request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_request_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_request_items
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

-- ---------------------------------------------------------------------
-- GRANT to app_service (production role) — guarded, local dev/CI have no
-- app_service role.
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_service') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_requests, purchase_request_items TO app_service';
  END IF;
END
$$;
