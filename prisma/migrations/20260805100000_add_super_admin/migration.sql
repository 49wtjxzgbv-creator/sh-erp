-- Migration: add_super_admin
--
-- Adds the SuperAdmin/SuperAdminAuditLog tables (schema.prisma's new
-- "Global System Administration" section, added during the production-
-- readiness audit on 2026-08-05) and the `super_admin_service` Postgres
-- role — a THIRD BYPASSRLS role alongside `app_user` (RLS-bound, no
-- bypass) and `auth_service` (ADR-0009, narrowly scoped to 3 pre-tenant
-- auth flows: login/refresh/company-discovery). This role is used ONLY by
-- backend/src/modules/super-admin/super-admin-prisma.service.ts, which is
-- ONLY injected into SuperAdminModule's own services — never reused by
-- `auth_service` or `app_user`, a deliberate boundary (see
-- docs/adr/0010-super-admin-role.md for the full rationale).
--
-- ORDERING: run after 20260805000000_enable_rls_and_check_constraints —
-- FORCE ROW LEVEL SECURITY must already be enabled on companies/plans/etc.
-- for the BYPASSRLS grant below to mean anything real.
--
-- Verified via pglast (real libpg_query grammar parsing), not a live
-- database — same standing verification method used for every hand-authored
-- migration in this project (see backend/README.md). Confirm with
-- `\du super_admin_service` + a real super-admin login smoke test before
-- trusting this in production.

CREATE TABLE "super_admins" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" CITEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "super_admins_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "super_admins_email_key" ON "super_admins"("email");

CREATE TABLE "super_admin_audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "superAdminId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "super_admin_audit_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "super_admin_audit_log_superAdminId_idx" ON "super_admin_audit_log"("superAdminId");
CREATE INDEX "super_admin_audit_log_targetType_targetId_idx" ON "super_admin_audit_log"("targetType", "targetId");

ALTER TABLE "super_admin_audit_log" ADD CONSTRAINT "super_admin_audit_log_superAdminId_fkey" FOREIGN KEY ("superAdminId") REFERENCES "super_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- super_admin_service role
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'super_admin_service') THEN
    -- CHANGE THIS PASSWORD before applying to any real environment — this
    -- placeholder exists only so the statement is runnable as written.
    CREATE ROLE super_admin_service LOGIN PASSWORD 'changeme-rotate-before-production';
  END IF;
END
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM super_admin_service;

-- Its own tables: full control (this IS its data). No DELETE on the audit
-- log — append-only, matching AuditEvent's own convention.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE super_admins TO super_admin_service;
GRANT SELECT, INSERT ON TABLE super_admin_audit_log TO super_admin_service;

-- Cross-tenant reads/writes needed for the actual Super Admin feature set:
-- see all companies (and block/unblock via UPDATE .status), create
-- companies manually (INSERT, via the same CompanyService.createCompany
-- every public signup already uses), see all users, resolve who to
-- impersonate, manage plans, change a company's subscription, and view the
-- global audit log. No DELETE anywhere on tenant tables — matches this
-- schema's "corrections are new state, never erasure" convention
-- (database-schema.md).
GRANT SELECT, INSERT, UPDATE ON TABLE companies TO super_admin_service;
GRANT SELECT, INSERT ON TABLE users TO super_admin_service;
GRANT SELECT ON TABLE company_memberships TO super_admin_service;
GRANT SELECT ON TABLE roles TO super_admin_service;
GRANT SELECT, INSERT, UPDATE ON TABLE plans TO super_admin_service;
GRANT SELECT, UPDATE ON TABLE company_subscriptions TO super_admin_service;
GRANT SELECT ON TABLE audit_events TO super_admin_service;

-- Impersonation ("log into any company") mints a normal, ordinary access
-- token for an existing user in the target company — it does not create a
-- session record of its own kind, so no extra table grant is needed beyond
-- the SELECTs above (companies/users/company_memberships) used to resolve
-- who to impersonate as.

ALTER ROLE super_admin_service BYPASSRLS;
