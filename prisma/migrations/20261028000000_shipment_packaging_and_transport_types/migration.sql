-- AlterTable
ALTER TABLE "assemblies" ADD COLUMN     "boxHeightCm" DECIMAL(8,2),
ADD COLUMN     "boxLengthCm" DECIMAL(8,2),
ADD COLUMN     "boxWidthCm" DECIMAL(8,2),
ADD COLUMN     "boxesPerPallet" INTEGER,
ADD COLUMN     "unitsPerBox" INTEGER;

-- CreateTable
CREATE TABLE "transport_unit_types" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "maxWeightKg" DECIMAL(10,3) NOT NULL,
    "maxVolumeM3" DECIMAL(10,3),
    "maxPackages" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "legacyId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "transport_unit_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transport_unit_types_companyId_idx" ON "transport_unit_types"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "transport_unit_types_companyId_id_key" ON "transport_unit_types"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "transport_unit_types_companyId_legacyId_key" ON "transport_unit_types"("companyId", "legacyId");

-- AddForeignKey
ALTER TABLE "transport_unit_types" ADD CONSTRAINT "transport_unit_types_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- Row Level Security — tenant_isolation policy (ADR-0002 pattern,
-- identical to every other new company-scoped table, e.g.
-- 20261017000000_pdf_documents's own migration).
-- ---------------------------------------------------------------------

ALTER TABLE transport_unit_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE transport_unit_types FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON transport_unit_types
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

-- ---------------------------------------------------------------------
-- GRANT to app_service (production role) — guarded, local dev/CI have
-- no app_service role at all.
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_service') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON transport_unit_types TO app_service';
  END IF;
END
$$;
