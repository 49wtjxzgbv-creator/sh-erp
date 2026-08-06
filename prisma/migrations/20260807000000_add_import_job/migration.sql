-- ImportJob (2026-08-07 SHСклад import-wizard build) — see prisma/schema.prisma's
-- header comment on the model for how this differs from legacy_migration_runs.
-- New table + RLS combined in one migration (unlike 20260803000000_init /
-- 20260805000000_enable_rls_and_check_constraints, which were split because
-- RLS was retrofitted onto already-existing tables) since this table has
-- never existed without RLS.

CREATE TYPE "ImportJobStatus" AS ENUM (
  'PENDING', 'FETCHING', 'TRANSFORMING', 'LOADING', 'IMPORTING_PHOTOS', 'VERIFYING', 'COMPLETED', 'FAILED'
);

CREATE TABLE "import_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "status" "ImportJobStatus" NOT NULL DEFAULT 'PENDING',
  "step" TEXT,
  "sourceUrl" TEXT NOT NULL,
  "sourceTokenEncrypted" TEXT NOT NULL,
  "dryRun" BOOLEAN NOT NULL DEFAULT false,
  "totalPhotos" INTEGER,
  "processedPhotos" INTEGER NOT NULL DEFAULT 0,
  "warnings" JSONB,
  "report" JSONB,
  "errorMessage" TEXT,
  "startedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "completedAt" TIMESTAMPTZ(3),
  PRIMARY KEY ("id")
);

CREATE INDEX "idx_import_jobs_companyId_createdAt" ON "import_jobs" ("companyId", "createdAt");

ALTER TABLE "import_jobs" ADD CONSTRAINT "fk_import_jobs_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;

ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON import_jobs
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);
