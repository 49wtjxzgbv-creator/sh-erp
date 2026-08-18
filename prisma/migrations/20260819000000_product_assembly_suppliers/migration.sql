-- Migration: product_assembly_suppliers
--
-- Real many-to-many between Product/Assembly and Supplier, each row with
-- its own optional price — the multi-supplier feature Product.defaultSupplierId
-- / Assembly.defaultSupplierId could never express (both stay as-is,
-- unchanged, and remain the fallback when a product/assembly has zero rows
-- here — see ProductSupplier's schema.prisma header comment). ON DELETE
-- CASCADE on both FKs, same reasoning as supplier_portal_users
-- (20260813000000): a join row has no meaning once either side is gone.
--
-- Verified via pglast (real libpg_query grammar parsing), not a live
-- database — same standing verification method used for every hand-authored
-- migration in this project (see backend/README.md).

-- CreateTable
CREATE TABLE "product_suppliers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "price" DECIMAL(14,2),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_suppliers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_suppliers_productId_supplierId_key" ON "product_suppliers"("productId", "supplierId");
CREATE INDEX "product_suppliers_companyId_idx" ON "product_suppliers"("companyId");
CREATE INDEX "product_suppliers_supplierId_idx" ON "product_suppliers"("supplierId");

ALTER TABLE "product_suppliers" ADD CONSTRAINT "product_suppliers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_suppliers" ADD CONSTRAINT "product_suppliers_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_suppliers" ADD CONSTRAINT "product_suppliers_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE product_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_suppliers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON product_suppliers
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

-- CreateTable
CREATE TABLE "assembly_suppliers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "assemblyId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "price" DECIMAL(14,2),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assembly_suppliers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "assembly_suppliers_assemblyId_supplierId_key" ON "assembly_suppliers"("assemblyId", "supplierId");
CREATE INDEX "assembly_suppliers_companyId_idx" ON "assembly_suppliers"("companyId");
CREATE INDEX "assembly_suppliers_supplierId_idx" ON "assembly_suppliers"("supplierId");

ALTER TABLE "assembly_suppliers" ADD CONSTRAINT "assembly_suppliers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assembly_suppliers" ADD CONSTRAINT "assembly_suppliers_assemblyId_fkey" FOREIGN KEY ("assemblyId") REFERENCES "assemblies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assembly_suppliers" ADD CONSTRAINT "assembly_suppliers_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE assembly_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE assembly_suppliers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON assembly_suppliers
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);
