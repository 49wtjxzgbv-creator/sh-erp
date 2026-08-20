-- Migration: super_admin_supplier_portal_refresh_tokens
--
-- P0 fix (2026-08-20): both Super Admin and Supplier Portal sessions were
-- built stateless (single JWT, no refresh token, no DB session record —
-- docs/adr/0010-super-admin-role.md / 0011-supplier-portal-separate-auth.md)
-- on the stated rationale that these are low-frequency panels where a
-- reload-logs-you-out cost is acceptable. Live use showed that's real
-- friction. Adds one new refresh-token table PER surface (not a shared
-- polymorphic table — mirrors this codebase's established "narrow,
-- separately-scoped DB role per auth surface" convention: SuperAdmin's is
-- global/no-RLS like `super_admins` itself; Supplier Portal's is tenant-
-- scoped/RLS-protected like `supplier_portal_users`), each with the same
-- hash-at-rest/familyId/rotation/reuse-detection shape as the existing
-- `refresh_tokens` table (ADR-0006).
--
-- Verified via pglast (real libpg_query grammar parsing), matching this
-- project's standing hand-migration verification method (backend/README.md).

-- CreateTable
CREATE TABLE "super_admin_refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "superAdminId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" UUID NOT NULL,
    "device" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "absoluteExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "super_admin_refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "super_admin_refresh_tokens_tokenHash_key" ON "super_admin_refresh_tokens"("tokenHash");
CREATE INDEX "super_admin_refresh_tokens_superAdminId_idx" ON "super_admin_refresh_tokens"("superAdminId");
CREATE INDEX "super_admin_refresh_tokens_familyId_idx" ON "super_admin_refresh_tokens"("familyId");
CREATE INDEX "super_admin_refresh_tokens_expiresAt_idx" ON "super_admin_refresh_tokens"("expiresAt");

ALTER TABLE "super_admin_refresh_tokens" ADD CONSTRAINT "super_admin_refresh_tokens_superAdminId_fkey" FOREIGN KEY ("superAdminId") REFERENCES "super_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- No RLS: global, like super_admins itself.
GRANT SELECT, INSERT, UPDATE ON TABLE super_admin_refresh_tokens TO super_admin_service;

-- CreateTable
CREATE TABLE "supplier_portal_refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "supplierPortalUserId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" UUID NOT NULL,
    "device" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_portal_refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supplier_portal_refresh_tokens_tokenHash_key" ON "supplier_portal_refresh_tokens"("tokenHash");
CREATE INDEX "supplier_portal_refresh_tokens_supplierPortalUserId_idx" ON "supplier_portal_refresh_tokens"("supplierPortalUserId");
CREATE INDEX "supplier_portal_refresh_tokens_familyId_idx" ON "supplier_portal_refresh_tokens"("familyId");
CREATE INDEX "supplier_portal_refresh_tokens_expiresAt_idx" ON "supplier_portal_refresh_tokens"("expiresAt");

ALTER TABLE "supplier_portal_refresh_tokens" ADD CONSTRAINT "supplier_portal_refresh_tokens_supplierPortalUserId_fkey" FOREIGN KEY ("supplierPortalUserId") REFERENCES "supplier_portal_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant-scoped, RLS-protected exactly like supplier_portal_users
-- (20260813000000_supplier_portal).
ALTER TABLE supplier_portal_refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_portal_refresh_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON supplier_portal_refresh_tokens
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

-- supplier_portal_auth_service (BYPASSRLS) already exists for the
-- pre-tenant-context lookup-by-email step on supplier_portal_users; extend
-- its grant list to also cover the pre-tenant-context lookup-by-tokenHash
-- step this table needs (INSERT/UPDATE too — issuing/rotating tokens on
-- login/refresh happens through this same role, before a tenant context
-- exists).
GRANT SELECT, INSERT, UPDATE ON TABLE supplier_portal_refresh_tokens TO supplier_portal_auth_service;
