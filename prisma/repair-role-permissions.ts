// One-off, idempotent corrective script (2026-08-06 auth-flow incident).
//
// Root cause: this production database's `permissions` table was empty —
// `prisma db seed` (which upserts PERMISSIONS_CATALOGUE, see seed.ts) had
// never actually run with the current seed.ts against this database. Both
// existing companies' 5 system roles were correctly created by
// RolesService.seedDefaultRoles at their original signup time, but that
// method reads `tx.permission.findMany()` to resolve permission keys to
// ids — against an empty Permission table, every resolution failed
// silently (`.filter((id): id is string => Boolean(id))` drops undefined
// matches rather than throwing), so every role ended up with zero
// role_permissions rows. Every `@RequirePermissions(...)` check for every
// regular company user then 403'd.
//
// This script does NOT touch seedDefaultRoles or prisma/seed.ts (which
// stays correct for future signups once `permissions` is populated for
// real) — it backfills exactly the missing links for companies that
// already exist, reading from the same DEFAULT_ROLES source of truth.
//
// Safe to run more than once: `skipDuplicates: true` makes every insert a
// no-op for a link that already exists. Does not delete, update, or reset
// anything — purely additive. Run AFTER `npx prisma db seed` (that's what
// populates the `permissions` table this script reads from).
import { PrismaClient } from '@prisma/client';
import { DEFAULT_ROLES } from '../backend/src/modules/authorization/permissions.catalogue';

const prisma = new PrismaClient();

async function main() {
  const companies = await prisma.company.findMany({ select: { id: true, slug: true } });

  for (const company of companies) {
    await prisma.$transaction(async (tx) => {
      // Same RLS-activation pattern as PrismaService.runInTenantTransaction
      // (backend/src/prisma/prisma.service.ts) — `roles` is a FORCE RLS
      // tenant-scoped table, so this is required for correctness even
      // though the current DATABASE_URL role happens to bypass RLS today.
      await tx.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${company.id}'`);

      const allPermissions = await tx.permission.findMany();
      const permissionIdByKey = new Map(allPermissions.map((p) => [p.key, p.id]));

      const roles = await tx.role.findMany({ where: { companyId: company.id, isSystem: true } });

      for (const role of roles) {
        const def = DEFAULT_ROLES.find((d) => d.name === role.name);
        if (!def) {
          console.log(`  [${company.slug}] role "${role.name}" has no matching DEFAULT_ROLES entry — skipped.`);
          continue;
        }

        const grants = def.permissions
          .map((key) => permissionIdByKey.get(key))
          .filter((id): id is string => Boolean(id))
          .map((permissionId) => ({ roleId: role.id, permissionId }));

        if (grants.length === 0) continue;

        const result = await tx.rolePermission.createMany({ data: grants, skipDuplicates: true });
        console.log(`  [${company.slug}] role "${role.name}": +${result.count} permission link(s) (target ${grants.length}).`);
      }
    });
  }

  console.log('Done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
