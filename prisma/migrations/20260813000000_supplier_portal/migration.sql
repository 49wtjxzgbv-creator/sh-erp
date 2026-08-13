-- Migration: supplier_portal
--
-- Adds SupplierPortalUser — a separate auth surface for suppliers, mirroring
-- SuperAdmin's "separate table, not a User flag" pattern (docs/adr/0010-
-- super-admin-role.md) because RequestUser's "member of exactly one
-- Company with a Role" model doesn't fit an actor whose whole scope is
-- "my own purchase orders" — see docs/adr/0011-supplier-portal-separate-
-- auth.md for the full rationale. Data access AFTER login reuses the
-- regular app_user/RLS-scoped tenant client (same as every other table
-- below — see 20260807000000_add_import_job for the same "new tenant
-- table + RLS in one migration" precedent), with the narrower "only THIS
-- supplier's rows" boundary enforced at the application layer.
--
-- LOGIN itself has the exact same bootstrapping problem ADR-0009 already
-- solved for AuthService: looking a portal user up by email has to happen
-- BEFORE a companyId is known (determining it IS the point of the lookup),
-- which is structurally impossible through a FORCE-RLS table via app_user.
-- Rather than exporting AuthPrismaService outside IdentityModule (breaking
-- its own documented "not exported, no other module can inject it"
-- boundary), this mints a FOURTH narrowly-scoped BYPASSRLS role,
-- `supplier_portal_auth_service` — same shape as `auth_service`, just
-- confined to the one table this feature actually needs pre-tenant-context
-- access to.
--
-- Also adds supplier-confirmation fields on PurchaseOrder/PurchaseOrderItem
-- — informational fields the supplier fills in via the portal, deliberately
-- separate from the existing internal expectedPrice/actualPrice/
-- expectedDeliveryDate columns (those stay "what we asked for" / "what
-- staff recorded"; these are "what the supplier told us").
--
-- Verified via pglast (real libpg_query grammar parsing), not a live
-- database — same standing verification method used for every hand-authored
-- migration in this project (see backend/README.md).

-- CreateTable
CREATE TABLE "supplier_portal_users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_portal_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supplier_portal_users_supplierId_key" ON "supplier_portal_users"("supplierId");
CREATE UNIQUE INDEX "supplier_portal_users_email_key" ON "supplier_portal_users"("email");
CREATE INDEX "supplier_portal_users_companyId_idx" ON "supplier_portal_users"("companyId");

ALTER TABLE "supplier_portal_users" ADD CONSTRAINT "supplier_portal_users_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE supplier_portal_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_portal_users FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON supplier_portal_users
  USING ("companyId" = current_setting('app.current_company_id', true)::uuid);

-- AlterTable
ALTER TABLE "purchase_orders"
  ADD COLUMN "supplierConfirmedAt" TIMESTAMPTZ(3),
  ADD COLUMN "supplierConfirmedDeliveryDate" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "purchase_order_items"
  ADD COLUMN "supplierConfirmedPrice" DECIMAL(14,2);

-- ---------------------------------------------------------------------------
-- supplier_portal_auth_service role — pre-tenant-context login lookup only
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supplier_portal_auth_service') THEN
    -- CHANGE THIS PASSWORD before applying to any real environment — this
    -- placeholder exists only so the statement is runnable as written.
    CREATE ROLE supplier_portal_auth_service LOGIN PASSWORD 'changeme-rotate-before-production';
  END IF;
END
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM supplier_portal_auth_service;

-- Only table this role ever touches. SELECT for the login lookup by email;
-- UPDATE restricted in practice to lastLoginAt (SupplierPortalAuthService's
-- only write). No INSERT/DELETE — creating/deactivating a portal account
-- happens through the normal authenticated app_user path (internal staff,
-- SuppliersController#portal-invite/portal-deactivate), a different code
-- path than login and one that already has a real tenant context.
GRANT SELECT, UPDATE ON TABLE supplier_portal_users TO supplier_portal_auth_service;

-- Safe for the same reason ADR-0009 gives for auth_service: the one query
-- this role runs is scoped by `email`, already unique enough on its own —
-- cross-tenant visibility was never the risk here, determining which
-- tenant a login belongs to is the actual job of this code path.
ALTER ROLE supplier_portal_auth_service BYPASSRLS;
