/**
 * Fixed permission catalogue for the Super Admin RBAC layer (P0 fix,
 * 2026-08-20) — mirrors the shape of the tenant-side
 * `../authorization/permissions.catalogue.ts` (fixed, code-defined list,
 * DB-mirrored into `super_admin_permissions`, not editable through any UI),
 * sized for a GLOBAL context: there is only one Super Admin org, so unlike
 * the tenant `Role` model, `SuperAdminRole` carries no `companyId`.
 *
 * This is the source of truth prisma/seed.ts reads from for local-dev
 * convenience; the actual production grandfather-in seeding runs inside
 * the migration itself (20260820210000_super_admin_rbac) since seed.ts
 * isn't guaranteed to run against production on every deploy — the two
 * lists must be kept in sync by hand if this ever changes.
 *
 * Enforcement note: only `companies:impersonate` is wired to an actual
 * guard in this pass (`CompaniesAdminController#impersonate`). The other
 * five keys exist and match what their respective controllers already do,
 * but aren't gated yet — real, reusable infrastructure for gating more
 * actions later, not a retrofit of every existing endpoint now.
 */
export interface SuperAdminPermissionDefinition {
  key: string;
  resource: string;
  action: string;
  description: string;
}

export const SUPER_ADMIN_PERMISSIONS_CATALOGUE: SuperAdminPermissionDefinition[] = [
  { key: 'companies:manage', resource: 'companies', action: 'manage', description: 'Create/edit companies, block/unblock.' },
  { key: 'companies:impersonate', resource: 'companies', action: 'impersonate', description: 'Log in as a member of any company.' },
  { key: 'users:manage', resource: 'users', action: 'manage', description: 'View/manage users and company memberships across all companies.' },
  { key: 'plans:manage', resource: 'plans', action: 'manage', description: "Create/edit subscription plans and change a company's plan." },
  { key: 'landing:manage', resource: 'landing', action: 'manage', description: 'Edit and publish the public landing page.' },
  { key: 'audit:read', resource: 'audit', action: 'read', description: 'View the global Super Admin audit log.' },
];
