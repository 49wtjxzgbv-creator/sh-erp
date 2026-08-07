-- Universal import platform, provider-agnostic (2026-08-07, same-day revision
-- of 20260807000000_add_import_job after architecture review) — see
-- prisma/schema.prisma's ImportConnection/ImportJob header comments for the
-- full design. import_jobs already exists in production with the OLD
-- sourceUrl/sourceTokenEncrypted columns (0 rows, confirmed before writing
-- this) — this migration ALTERs it to the new shape rather than recreating
-- it, and adds the new import_connections table.

CREATE TYPE "ImportConnectionStatus" AS ENUM ('PENDING', 'PAIRED', 'REVOKED');

CREATE TABLE "import_connections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "providerType" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "configEncrypted" TEXT,
  "status" "ImportConnectionStatus" NOT NULL DEFAULT 'PENDING',
  "pairingCode" TEXT,
  "pairingCodeExpiresAt" TIMESTAMPTZ(3),
  "protocolVersion" TEXT,
  "connectorVersion" TEXT,
  "lastHealthCheckAt" TIMESTAMPTZ(3),
  "lastHealthStatus" JSONB,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "pairedAt" TIMESTAMPTZ(3),
  "revokedAt" TIMESTAMPTZ(3),
  PRIMARY KEY ("id")
);

CREATE INDEX "idx_import_connections_companyId" ON "import_connections" ("companyId");

ALTER TABLE "import_connections" ADD CONSTRAINT "fk_import_connections_company" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT;

ALTER TABLE import_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON import_connections
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

-- import_jobs: drop the old URL-as-credential columns, add connectionId + errors + durationMs.
-- No existing rows in production, so a NOT NULL "connectionId" with no default is safe.
ALTER TABLE "import_jobs" DROP COLUMN "sourceUrl";
ALTER TABLE "import_jobs" DROP COLUMN "sourceTokenEncrypted";
ALTER TABLE "import_jobs" ADD COLUMN "connectionId" UUID NOT NULL;
ALTER TABLE "import_jobs" ADD COLUMN "errors" JSONB;
ALTER TABLE "import_jobs" ADD COLUMN "durationMs" INTEGER;

CREATE INDEX "idx_import_jobs_connectionId_createdAt" ON "import_jobs" ("connectionId", "createdAt");

ALTER TABLE "import_jobs" ADD CONSTRAINT "fk_import_jobs_connection" FOREIGN KEY ("connectionId") REFERENCES "import_connections" ("id") ON DELETE RESTRICT;
