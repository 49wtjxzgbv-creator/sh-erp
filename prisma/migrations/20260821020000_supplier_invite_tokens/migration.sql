-- Migration: supplier_invite_tokens (P1, 2026-08-21, ADR-0013)
--
-- Self-service supplier registration: closes the gap that
-- `SuppliersService.invitePortal()` requires staff to already know the
-- supplier's exact portal email. Staff generate a single-use, expiring
-- token for an EXISTING `Supplier` row that has no `SupplierConnection`
-- yet, share the raw token out-of-band, and the supplier redeems it
-- themselves at `/supplier-portal/register?token=...` — either creating a
-- brand-new `SupplierOrganization` or proving ownership of an existing one
-- (by password) to attach a new `SupplierConnection` to this company.
--
-- RLS-scoped on companyId exactly like `supplier_connections` — staff
-- manage tokens through the normal app_user path. The public redemption
-- lookup/consume goes through the BYPASSRLS `supplier_portal_auth_service`
-- role — see the grants below and ADR-0013 for why this is the FIRST time
-- that role is granted INSERT on any table (previously SELECT/UPDATE-only
-- by deliberate design, per ADR-0011).
--
-- Verified via pglast (real libpg_query grammar parsing), not a live
-- database — same standing verification method used for every hand-
-- authored migration in this project.

-- ---------------------------------------------------------------------------
-- New table
-- ---------------------------------------------------------------------------

CREATE TABLE "supplier_invite_tokens" (
    "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId"   UUID NOT NULL,
    "supplierId"  UUID NOT NULL,
    "tokenHash"   TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "expiresAt"   TIMESTAMPTZ(3) NOT NULL,
    "consumedAt"  TIMESTAMPTZ(3),
    "revokedAt"   TIMESTAMPTZ(3),
    "createdAt"   TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_invite_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supplier_invite_tokens_tokenHash_key" ON "supplier_invite_tokens"("tokenHash");
CREATE INDEX "supplier_invite_tokens_companyId_idx" ON "supplier_invite_tokens"("companyId");
CREATE INDEX "supplier_invite_tokens_supplierId_idx" ON "supplier_invite_tokens"("supplierId");

ALTER TABLE "supplier_invite_tokens" ADD CONSTRAINT "supplier_invite_tokens_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_invite_tokens" ADD CONSTRAINT "supplier_invite_tokens_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE supplier_invite_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_invite_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON supplier_invite_tokens
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

-- ---------------------------------------------------------------------------
-- Grants
--
-- supplier_portal_auth_service gets SELECT+UPDATE on this new table (public
-- lookup + atomic consume — never INSERT here, tokens are only ever
-- created by staff through the normal app_user path).
--
-- It ALSO gets, for the first time, SELECT on `suppliers` and INSERT on
-- `supplier_organizations`/`supplier_portal_users`/`supplier_connections` —
-- previously this role could only SELECT/UPDATE existing rows in those
-- three tables (ADR-0011's deliberate "account creation only happens
-- through app_user" boundary). Self-service registration is structurally
-- pre-tenant-context (there IS no app_user path before the supplier has
-- redeemed a token), so this is the one place that boundary is
-- intentionally crossed. The compensating control is NOT this grant being
-- narrow — INSERT is INSERT — it's that the application code path gating
-- it only ever proceeds after validating a single-use, unexpired,
-- unrevoked `supplier_invite_tokens` row scoped to exactly one
-- (companyId, supplierId) pair. See ADR-0013.
-- ---------------------------------------------------------------------------

GRANT SELECT, UPDATE ON TABLE "supplier_invite_tokens" TO supplier_portal_auth_service;
GRANT SELECT ON TABLE "suppliers" TO supplier_portal_auth_service;
GRANT INSERT ON TABLE "supplier_organizations" TO supplier_portal_auth_service;
GRANT INSERT ON TABLE "supplier_portal_users" TO supplier_portal_auth_service;
GRANT INSERT ON TABLE "supplier_connections" TO supplier_portal_auth_service;
