-- Migration: supplier_organization_multi_company (P0, 2026-08-21, ADR-0012)
--
-- Replaces the Supplier Portal's hard 1:1 "one portal account = one
-- Supplier row = one Company" link with a real many-to-many: one global
-- `SupplierOrganization` (the real-world supplier's identity — one login)
-- connected to many companies via `SupplierConnection` rows, each pointing
-- at that company's OWN, completely unchanged `Supplier` row.
--
-- `Supplier`/`ProductSupplier`/`AssemblySupplier`/`PurchaseOrder`/
-- `PurchaseOrderItem` are untouched — they already correctly scope by
-- (companyId, supplierId), which is exactly "how this one company records
-- this vendor" regardless of how the vendor authenticates.
--
-- `supplier_portal_users`/`supplier_portal_refresh_tokens` become GLOBAL
-- tables (no RLS) — mirrors `super_admins`/`super_admin_refresh_tokens'`
-- own shape, since a portal identity is no longer scoped to one company at
-- all. `supplier_connections` is where the real per-company RLS boundary
-- now lives, mirroring `ImportConnection`/`ImportConnectionStatus`'s
-- existing PENDING/PAIRED/REVOKED shape (this schema's own established
-- "connection between a company and an external thing" pattern —
-- PAIRED renamed ACTIVE here for this domain's vocabulary).
--
-- Backfill (idempotent, guarded by `WHERE "supplierOrganizationId" IS
-- NULL`): every existing Supplier-with-a-portalUser gets exactly one new
-- SupplierOrganization + one ACTIVE SupplierConnection, so every existing
-- supplier keeps logging in and seeing the exact same orders after this
-- migration, with zero new accounts created.
--
-- DEPLOY NOTE: this migration and the corresponding backend code (which
-- stops reading the old `companyId`/`supplierId` columns) must ship in the
-- same release — the column drops at the end are a hard cutover for any
-- in-flight Supplier Portal session. Internal company-staff users are
-- entirely unaffected.
--
-- Verified via pglast (real libpg_query grammar parsing), not a live
-- database — same standing verification method used for every hand-
-- authored migration in this project (see backend/README.md).

-- ---------------------------------------------------------------------------
-- New tables
-- ---------------------------------------------------------------------------

-- CreateTable: SupplierOrganization — global identity, no companyId, no RLS.
CREATE TABLE "supplier_organizations" (
    "id"        UUID NOT NULL DEFAULT gen_random_uuid(),
    "name"      TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_organizations_pkey" PRIMARY KEY ("id")
);

-- CreateEnum
CREATE TYPE "SupplierConnectionStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');

-- CreateTable: SupplierConnection — the real per-company authorization
-- boundary. RLS on companyId (regular app_user/Company-staff side, exactly
-- like `suppliers` itself); supplier_portal_auth_service is granted
-- SELECT/UPDATE below for the portal's own cross-company reads.
CREATE TABLE "supplier_connections" (
    "id"                     UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId"              UUID NOT NULL,
    "supplierId"             UUID NOT NULL,
    "supplierOrganizationId" UUID NOT NULL,
    "status"                 "SupplierConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "invitedAt"              TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt"            TIMESTAMPTZ(3),
    "revokedAt"              TIMESTAMPTZ(3),
    "createdAt"              TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"              TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supplier_connections_supplierId_key" ON "supplier_connections"("supplierId");
CREATE INDEX "supplier_connections_companyId_idx" ON "supplier_connections"("companyId");
CREATE INDEX "supplier_connections_supplierOrganizationId_idx" ON "supplier_connections"("supplierOrganizationId");

ALTER TABLE "supplier_connections" ADD CONSTRAINT "supplier_connections_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_connections" ADD CONSTRAINT "supplier_connections_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_connections" ADD CONSTRAINT "supplier_connections_supplierOrganizationId_fkey" FOREIGN KEY ("supplierOrganizationId") REFERENCES "supplier_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE supplier_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON supplier_connections
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

-- ---------------------------------------------------------------------------
-- New (nullable-for-now) columns on the two existing portal tables
-- ---------------------------------------------------------------------------

ALTER TABLE "supplier_portal_users" ADD COLUMN "supplierOrganizationId" UUID;
ALTER TABLE "supplier_portal_users" ADD COLUMN "lastActiveConnectionId" UUID;

ALTER TABLE "supplier_portal_refresh_tokens" ADD COLUMN "activeConnectionId" UUID;

-- ---------------------------------------------------------------------------
-- Idempotent backfill — one SupplierOrganization + one ACTIVE
-- SupplierConnection per existing Supplier-with-a-portal-account.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  spu RECORD;
  new_org_id UUID;
  new_conn_id UUID;
BEGIN
  FOR spu IN SELECT * FROM "supplier_portal_users" WHERE "supplierOrganizationId" IS NULL LOOP
    new_org_id := gen_random_uuid();
    INSERT INTO "supplier_organizations" ("id", "name", "createdAt", "updatedAt")
      SELECT new_org_id, s."name", spu."createdAt", spu."createdAt"
      FROM "suppliers" s WHERE s."id" = spu."supplierId";

    new_conn_id := gen_random_uuid();
    INSERT INTO "supplier_connections"
      ("id", "companyId", "supplierId", "supplierOrganizationId", "status", "invitedAt", "respondedAt", "createdAt", "updatedAt")
      VALUES (new_conn_id, spu."companyId", spu."supplierId", new_org_id, 'ACTIVE', spu."createdAt", spu."createdAt", spu."createdAt", spu."createdAt");

    UPDATE "supplier_portal_users"
      SET "supplierOrganizationId" = new_org_id, "lastActiveConnectionId" = new_conn_id
      WHERE "id" = spu."id";

    -- Every refresh token this portal user ever had was issued with this
    -- SAME companyId (SupplierPortalAuthService always signed
    -- issue(portalUser.id, portalUser.companyId) — one company per account
    -- was the whole point of the old model), so matching by
    -- supplierPortalUserId alone is correct and keeps any in-flight
    -- session valid across this migration.
    UPDATE "supplier_portal_refresh_tokens"
      SET "activeConnectionId" = new_conn_id
      WHERE "supplierPortalUserId" = spu."id" AND "activeConnectionId" IS NULL;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- Enforce NOT NULL + real FKs now that backfill is complete
-- ---------------------------------------------------------------------------

ALTER TABLE "supplier_portal_users" ALTER COLUMN "supplierOrganizationId" SET NOT NULL;
CREATE UNIQUE INDEX "supplier_portal_users_supplierOrganizationId_key" ON "supplier_portal_users"("supplierOrganizationId");
ALTER TABLE "supplier_portal_users" ADD CONSTRAINT "supplier_portal_users_supplierOrganizationId_fkey" FOREIGN KEY ("supplierOrganizationId") REFERENCES "supplier_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_portal_users" ADD CONSTRAINT "supplier_portal_users_lastActiveConnectionId_fkey" FOREIGN KEY ("lastActiveConnectionId") REFERENCES "supplier_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "supplier_portal_refresh_tokens" ALTER COLUMN "activeConnectionId" SET NOT NULL;
CREATE INDEX "supplier_portal_refresh_tokens_activeConnectionId_idx" ON "supplier_portal_refresh_tokens"("activeConnectionId");
ALTER TABLE "supplier_portal_refresh_tokens" ADD CONSTRAINT "supplier_portal_refresh_tokens_activeConnectionId_fkey" FOREIGN KEY ("activeConnectionId") REFERENCES "supplier_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Drop the old 1:1-with-one-company link entirely. Both tables become
-- global (no RLS) — a portal identity/session is no longer scoped to one
-- company at all; `supplier_connections` is where that boundary lives now.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS tenant_isolation ON "supplier_portal_users";
ALTER TABLE "supplier_portal_users" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "supplier_portal_users" DISABLE ROW LEVEL SECURITY;

ALTER TABLE "supplier_portal_users" DROP CONSTRAINT "supplier_portal_users_supplierId_fkey";
DROP INDEX "supplier_portal_users_supplierId_key";
DROP INDEX "supplier_portal_users_companyId_idx";
ALTER TABLE "supplier_portal_users" DROP COLUMN "companyId";
ALTER TABLE "supplier_portal_users" DROP COLUMN "supplierId";

DROP POLICY IF EXISTS tenant_isolation ON "supplier_portal_refresh_tokens";
ALTER TABLE "supplier_portal_refresh_tokens" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "supplier_portal_refresh_tokens" DISABLE ROW LEVEL SECURITY;

ALTER TABLE "supplier_portal_refresh_tokens" DROP COLUMN "companyId";

-- ---------------------------------------------------------------------------
-- Grants — extends supplier_portal_auth_service (BYPASSRLS, already exists
-- since 20260813000000_supplier_portal) to the two new tables. No INSERT
-- on either: new SupplierOrganization/SupplierConnection rows are only
-- ever created through the regular, authenticated app_user path
-- (SuppliersService#invitePortal, already inside a real tenant context —
-- same reasoning ADR-0011 gives for why supplier_portal_users itself has
-- no INSERT grant for this role). UPDATE on supplier_connections covers
-- accept/decline (portal side) and the per-request status re-check;
-- revoking a connection (deactivatePortal) stays on the app_user path.
-- ---------------------------------------------------------------------------

GRANT SELECT, UPDATE ON TABLE "supplier_connections" TO supplier_portal_auth_service;
GRANT SELECT ON TABLE "supplier_organizations" TO supplier_portal_auth_service;
