-- Quotations module (new, 2026-08-27): Customer directory, safe per-company
-- document numbering, and the Quotation/QuotationVersion/QuotationVersionItem/
-- QuotationTemplate tree. See schema.prisma's own SECTION comment for the
-- design rationale (mirrors AssemblyVersion for immutable snapshotting,
-- Supplier for the Customer directory shape).

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "QuotationItemKind" AS ENUM ('ASSEMBLY', 'PRODUCT', 'SERVICE', 'DELIVERY', 'INSTALLATION', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PricingSource" AS ENUM ('BASE_PRICE', 'MARKUP_PERCENT', 'COST_PLUS_MARGIN', 'CUSTOM');

-- AlterTable: Assembly gets its own customer-facing sale price, deliberately
-- separate from the four existing *CostPerUnit columns (cost) and from
-- Product.sellPriceEur (a cost input, not a retail price) — see the field's
-- own schema.prisma comment.
ALTER TABLE "assemblies" ADD COLUMN "baseSalePriceEur" DECIMAL(14,2);

-- AlterTable: CustomerOrder gets an OPTIONAL link to the new Customer
-- directory and to whichever Quotation it was converted from — additive
-- only, clientName is untouched (see the fields' own schema.prisma comments
-- for why a hard cutover is out of scope).
ALTER TABLE "customer_orders" ADD COLUMN "customerId" UUID,
ADD COLUMN "sourceQuotationId" UUID,
ADD COLUMN "sourceQuotationVersionId" UUID;

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "legacyId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable: no "id" column — the (companyId, counterKey) pair IS the
-- primary key, so a new counterKey (e.g. a new year embedded directly in
-- the key, "QUOTATION_2027") starts counting from 0 via the upsert's
-- INSERT branch with no separate reset logic.
CREATE TABLE "company_document_counters" (
    "companyId" UUID NOT NULL,
    "counterKey" TEXT NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "company_document_counters_pkey" PRIMARY KEY ("companyId","counterKey")
);

-- CreateTable
CREATE TABLE "quotation_templates" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "accentColor" TEXT,
    "printLogoFileId" UUID,
    "companyDetailsText" TEXT,
    "headerText" TEXT,
    "footerText" TEXT,
    "visibleBlocks" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "quotation_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotations" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" UUID NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "duplicatedFromId" UUID,
    "convertedCustomerOrderId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable: immutable once sentAt is set — see the model's own
-- schema.prisma comment for the full snapshot rationale.
CREATE TABLE "quotation_versions" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "quotationId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "sentAt" TIMESTAMPTZ(3),
    "viewedAt" TIMESTAMPTZ(3),
    "acceptedAt" TIMESTAMPTZ(3),
    "rejectedAt" TIMESTAMPTZ(3),
    "validUntil" TIMESTAMPTZ(3),
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "paymentTerms" TEXT,
    "deliveryTerms" TEXT,
    "installationTerms" TEXT,
    "notes" TEXT,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "templateId" UUID,
    "templateSnapshot" JSONB,
    "companySnapshot" JSONB,
    "pdfFileId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotation_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_version_items" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "quotationVersionId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "kind" "QuotationItemKind" NOT NULL,
    "assemblyId" UUID,
    "productId" UUID,
    "nameSnapshot" TEXT NOT NULL,
    "descriptionSnapshot" TEXT,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'шт',
    "pricingSource" "PricingSource" NOT NULL,
    "costSnapshot" DECIMAL(14,2),
    "basePriceSnapshot" DECIMAL(14,2),
    "pricingPercent" DECIMAL(6,3),
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "discountPercent" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "belowCostApproved" BOOLEAN NOT NULL DEFAULT false,
    "belowCostApprovedById" UUID,

    CONSTRAINT "quotation_version_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_companyId_idx" ON "customers"("companyId");
CREATE UNIQUE INDEX "customers_companyId_id_key" ON "customers"("companyId", "id");

CREATE INDEX "quotation_templates_companyId_idx" ON "quotation_templates"("companyId");

CREATE INDEX "quotations_companyId_status_idx" ON "quotations"("companyId", "status");
CREATE INDEX "quotations_companyId_customerId_idx" ON "quotations"("companyId", "customerId");
CREATE UNIQUE INDEX "quotations_companyId_id_key" ON "quotations"("companyId", "id");
CREATE UNIQUE INDEX "quotations_companyId_number_key" ON "quotations"("companyId", "number");

CREATE INDEX "quotation_versions_companyId_quotationId_idx" ON "quotation_versions"("companyId", "quotationId");
CREATE UNIQUE INDEX "quotation_versions_quotationId_versionNumber_key" ON "quotation_versions"("quotationId", "versionNumber");
CREATE UNIQUE INDEX "quotation_versions_companyId_id_key" ON "quotation_versions"("companyId", "id");

CREATE INDEX "quotation_version_items_companyId_quotationVersionId_idx" ON "quotation_version_items"("companyId", "quotationVersionId");

CREATE INDEX "customer_orders_companyId_customerId_idx" ON "customer_orders"("companyId", "customerId");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "company_document_counters" ADD CONSTRAINT "company_document_counters_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "quotation_templates" ADD CONSTRAINT "quotation_templates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "quotations" ADD CONSTRAINT "quotations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_companyId_customerId_fkey" FOREIGN KEY ("companyId", "customerId") REFERENCES "customers"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_companyId_duplicatedFromId_fkey" FOREIGN KEY ("companyId", "duplicatedFromId") REFERENCES "quotations"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "quotation_versions" ADD CONSTRAINT "quotation_versions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotation_versions" ADD CONSTRAINT "quotation_versions_companyId_quotationId_fkey" FOREIGN KEY ("companyId", "quotationId") REFERENCES "quotations"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quotation_version_items" ADD CONSTRAINT "quotation_version_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotation_version_items" ADD CONSTRAINT "quotation_version_items_companyId_quotationVersionId_fkey" FOREIGN KEY ("companyId", "quotationVersionId") REFERENCES "quotation_versions"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_orders" ADD CONSTRAINT "customer_orders_companyId_customerId_fkey" FOREIGN KEY ("companyId", "customerId") REFERENCES "customers"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_orders" ADD CONSTRAINT "customer_orders_companyId_sourceQuotationId_fkey" FOREIGN KEY ("companyId", "sourceQuotationId") REFERENCES "quotations"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_orders" ADD CONSTRAINT "customer_orders_companyId_sourceQuotationVersionId_fkey" FOREIGN KEY ("companyId", "sourceQuotationVersionId") REFERENCES "quotation_versions"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- Row Level Security — tenant_isolation policy on every new table
-- (ADR-0002 pattern, identical to sub_assembly_reservations' own
-- migration). company_document_counters included even though it's an
-- internal bookkeeping table with no direct user-facing read path — a
-- counter row leaking cross-tenant would still leak "how many quotations
-- has company X created," which is exactly the kind of business-volume
-- signal RLS exists to keep private.
-- ---------------------------------------------------------------------

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customers
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE company_document_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_document_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON company_document_counters
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE quotation_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON quotation_templates
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON quotations
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE quotation_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON quotation_versions
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

ALTER TABLE quotation_version_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_version_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON quotation_version_items
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

-- ---------------------------------------------------------------------
-- GRANT to app_service (production role) — guarded, see header comment
-- in other migrations for why (local dev/CI have no app_service role)
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_service') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON customers, company_document_counters, quotation_templates, quotations, quotation_versions, quotation_version_items TO app_service';
  END IF;
END
$$;
