-- Migration: super_admin_rbac
--
-- P0 fix (2026-08-20): every Super Admin currently has identical,
-- undifferentiated rights (SuperAdminGuard only verifies identity, never
-- checks any permission — there was no permission concept at all). Adds a
-- real RBAC layer mirroring the shape of the existing tenant-side
-- Permission/Role/RolePermission trio (authorization.module.ts), sized for
-- a GLOBAL context — there is only one Super Admin org, so (unlike the
-- tenant `Role` model) none of these three tables carry a companyId.
--
-- For this task, enforcement is wired onto exactly one endpoint
-- (CompaniesAdminController#impersonate, gated on the new
-- "companies:impersonate" permission) — the other five seeded permissions
-- exist now (matching what the Super Admin panel's controllers already
-- do) but aren't enforced yet; real, reusable infrastructure for gating
-- more actions later, not retrofitted everywhere in this pass.
--
-- Grandfather-in step (below) runs INSIDE this migration, not just
-- prisma/seed.ts, because seed is dev-convenience tooling that isn't
-- guaranteed to run against production on every deploy — the migration
-- itself is the actual safety guarantee that no existing Super Admin
-- account loses access. Every INSERT is idempotent (ON CONFLICT DO
-- NOTHING), safe to re-run.
--
-- Verified via pglast (real libpg_query grammar parsing), matching this
-- project's standing hand-migration verification method (backend/README.md).

-- CreateTable
CREATE TABLE "super_admin_permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "super_admin_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "super_admin_permissions_key_key" ON "super_admin_permissions"("key");

-- CreateTable
CREATE TABLE "super_admin_roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "super_admin_roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "super_admin_roles_name_key" ON "super_admin_roles"("name");

-- CreateTable
CREATE TABLE "super_admin_role_permissions" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "super_admin_role_permissions_pkey" PRIMARY KEY ("roleId", "permissionId")
);

ALTER TABLE "super_admin_role_permissions" ADD CONSTRAINT "super_admin_role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "super_admin_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "super_admin_role_permissions" ADD CONSTRAINT "super_admin_role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "super_admin_permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "super_admins" ADD COLUMN "roleId" UUID;
ALTER TABLE "super_admins" ADD CONSTRAINT "super_admins_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "super_admin_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- No RLS on any of these three tables — global platform data, not tenant
-- data, exactly like super_admins/super_admin_audit_log above them.

-- ---------------------------------------------------------------------------
-- Grandfather-in: seed the fixed catalogue, one all-permissions system
-- role, and backfill every existing SuperAdmin row. Idempotent.
-- ---------------------------------------------------------------------------

INSERT INTO "super_admin_permissions" ("id", "key", "resource", "action", "description") VALUES
  (gen_random_uuid(), 'companies:manage', 'companies', 'manage', 'Create/edit companies, block/unblock.'),
  (gen_random_uuid(), 'companies:impersonate', 'companies', 'impersonate', 'Log in as a member of any company.'),
  (gen_random_uuid(), 'users:manage', 'users', 'manage', 'View/manage users and company memberships across all companies.'),
  (gen_random_uuid(), 'plans:manage', 'plans', 'manage', 'Create/edit subscription plans and change a company''s plan.'),
  (gen_random_uuid(), 'landing:manage', 'landing', 'manage', 'Edit and publish the public landing page.'),
  (gen_random_uuid(), 'audit:read', 'audit', 'read', 'View the global Super Admin audit log.')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "super_admin_roles" ("id", "name", "description", "isSystem", "createdAt", "updatedAt")
  VALUES (gen_random_uuid(), 'Super Admin', 'Full platform access — seeded system role, grandfathers in every account created before RBAC existed.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  ON CONFLICT ("name") DO NOTHING;

INSERT INTO "super_admin_role_permissions" ("roleId", "permissionId")
  SELECT r.id, p.id
  FROM "super_admin_roles" r
  CROSS JOIN "super_admin_permissions" p
  WHERE r.name = 'Super Admin'
  ON CONFLICT DO NOTHING;

UPDATE "super_admins"
  SET "roleId" = (SELECT id FROM "super_admin_roles" WHERE name = 'Super Admin')
  WHERE "roleId" IS NULL;

-- super_admin_service (BYPASSRLS, least-privilege) only sees tables it's
-- explicitly granted — same requirement every prior Super-Admin-owned
-- table has had (20260805100000_add_super_admin, 20260820080000_landing_page).
-- SELECT-only: this task ships no role-management UI, so nothing writes to
-- these three tables through the app yet — extend when one does.
GRANT SELECT ON TABLE super_admin_permissions, super_admin_roles, super_admin_role_permissions TO super_admin_service;
