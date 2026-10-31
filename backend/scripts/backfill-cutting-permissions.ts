/**
 * Backfill for the real gap found while live-testing the cutting-stock
 * optimization feature (розкрій, 2026-10-31) on production: adding
 * 'cutting:read'/'cutting:write' to PERMISSIONS_CATALOGUE/DEFAULT_ROLES
 * only affects NEW companies going forward — RolesService#seedDefaultRoles
 * runs once, at company creation, and nothing re-syncs an existing
 * company's already-created isSystem Role rows when a later feature adds a
 * new permission key to the catalogue (confirmed: TenantScopeInterceptor's
 * permission check reads the real `role_permissions` join table, not
 * DEFAULT_ROLES live). Without this, not even an existing company's own
 * Admin role can use the new feature.
 *
 * For every existing company, for every isSystem role whose name matches a
 * DEFAULT_ROLES definition, grants whichever of the two new keys that
 * definition lists and the role doesn't already have. Narrowly scoped to
 * just these two new keys (not a general resync of every permission ever
 * added) — same "fix only what this change touches" scope as every other
 * one-off script in this directory. Custom (non-isSystem, or isSystem-named
 * oddly) roles are never touched — this only restores what DEFAULT_ROLES
 * already promised a company's own default roles.
 *
 * DRY_RUN by default. APPLY=1 writes. Loops every company via the same
 * parameterized set_config RLS-activation pattern as prisma.service.ts.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { DEFAULT_ROLES } from '../src/modules/authorization/permissions.catalogue';

const APPLY = process.env.APPLY === '1';
const NEW_KEYS = ['cutting:read', 'cutting:write'] as const;

async function main() {
  const prisma = new PrismaClient();
  try {
    const companies = await prisma.company.findMany({ select: { id: true, name: true } });
    const newPermissions = await prisma.permission.findMany({ where: { key: { in: [...NEW_KEYS] } } });
    const permissionIdByKey = new Map(newPermissions.map((p) => [p.key, p.id]));
    if (permissionIdByKey.size !== NEW_KEYS.length) {
      throw new Error(`Expected permissions ${NEW_KEYS.join(', ')} not found in the permissions table — run "prisma db seed" first.`);
    }

    let totalGrants = 0;

    for (const company of companies) {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_company_id', ${company.id}, true)`;

        const roles = await tx.role.findMany({ where: { isSystem: true }, include: { permissions: true } });

        for (const role of roles) {
          const defaultDef = DEFAULT_ROLES.find((d) => d.name === role.name);
          if (!defaultDef) continue;
          const defaultKeys: readonly string[] = defaultDef.permissions;

          const already = new Set(role.permissions.map((rp) => rp.permissionId));
          const toGrant = NEW_KEYS.filter((key) => defaultKeys.includes(key))
            .map((key) => permissionIdByKey.get(key)!)
            .filter((id) => !already.has(id));

          if (toGrant.length === 0) continue;

          console.log(`${company.name} (${company.id}) / ${role.name}: granting ${toGrant.length} permission(s)`);
          if (APPLY) {
            await tx.rolePermission.createMany({ data: toGrant.map((permissionId) => ({ roleId: role.id, permissionId })) });
          }
          totalGrants += toGrant.length;
        }
      });
    }

    console.log(`\n=== ${APPLY ? 'APPLIED' : 'DRY RUN'} ===`);
    console.log(`Grants ${APPLY ? 'created' : 'that would be created'}: ${totalGrants}`);
    if (!APPLY) console.log('\nDRY RUN — re-run with APPLY=1 to write.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
