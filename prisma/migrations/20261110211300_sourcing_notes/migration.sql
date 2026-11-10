-- "нотатки до товару/постачальника — короткий текстовий комент, видимий
-- усій команді" (2026-11-10). New table, same isolation reasoning as the
-- rest of the sourcing bot's own tables — not a note column on the core
-- products/suppliers tables. One row per (companyId, entityType, entityId),
-- upserted on save. Purely additive.

-- CreateTable
CREATE TABLE "sourcing_notes" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "note" TEXT NOT NULL,
    "updatedByUserId" UUID NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sourcing_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sourcing_notes_companyId_entityType_entityId_key" ON "sourcing_notes"("companyId", "entityType", "entityId");

-- AddForeignKey
ALTER TABLE "sourcing_notes" ADD CONSTRAINT "sourcing_notes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- Row Level Security — tenant_isolation policy (ADR-0002 pattern,
-- identical to every other company-scoped sourcing-bot table).
-- ---------------------------------------------------------------------

ALTER TABLE sourcing_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sourcing_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sourcing_notes
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

-- ---------------------------------------------------------------------
-- GRANT to app_service (production role) — guarded, local dev/CI have
-- no app_service role at all. Same shape as 20261109180000's own grant
-- block. Not granted to sourcing_bot_service — that BYPASSRLS role only
-- ever resolves chat-id -> user before any tenant context exists; all
-- actual note reads/writes go through the normal tenant-scoped
-- connection (app_service), same as every other sourcing-app endpoint.
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_service') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON sourcing_notes TO app_service';
  END IF;
END
$$;
