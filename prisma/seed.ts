// Global seed — run once per environment (`npm run prisma:seed` from
// backend/), NOT per company. Seeds:
//  - the fixed Permission catalogue (Phase 2 §6, Phase 3 §7) that
//    RolesService.seedDefaultRoles (backend/src/modules/authorization/
//    roles.service.ts) reads from when a new company signs up.
//  - the billing stub's Plan tiers (Module 12, Phase 0: "architecture
//    ready, Stripe integration not implemented yet") — `starter` is what
//    BillingService.seedDefaultSubscription assigns every new company by
//    default at signup. THIS is the exact table BillingService.
//    seedDefaultSubscription errors on ("Default plan \"starter\" not
//    found") if this seed was never actually run — a real production
//    incident during the 2026-08-05 audit traced back to `prisma db seed`
//    silently never having executed (DATABASE_URL not visible to the
//    process, ts-node invocation broken). ops/deploy.sh now runs this
//    seed as a mandatory, non-skippable step of every deploy — see that
//    script.
//  - the initial Super Admin account (SuperAdminModule, added during the
//    same audit) — idempotent upsert by email, so re-running this seed on
//    every deploy never creates duplicates or fights with a password
//    already changed through the Super Admin panel itself (see below).
//
// Per-company seeding (default roles, warehouse, units, production stages,
// QC checklist, VAT rate, subscription) happens at signup time in
// CompanyService, not here — see backend/src/modules/tenancy/company.service.ts.
// Relative import, not the bare `@prisma/client` specifier: this file has
// no node_modules of its own to resolve a bare specifier through (Node's
// resolution only walks up through ANCESTOR node_modules directories, and
// backend/ is a sibling of prisma/, never an ancestor) -- same reasoning
// as this file's existing relative import of permissions.catalogue below,
// and it's also the exact directory schema.prisma's own `output` now
// pins the real generated client to.
import { PrismaClient } from '../backend/node_modules/@prisma/client';
import * as argon2 from 'argon2';
import { PERMISSIONS_CATALOGUE } from '../backend/src/modules/authorization/permissions.catalogue';

const prisma = new PrismaClient();

const PLANS = [
  { key: 'starter', name: 'Starter', monthlyPriceEur: 0, limits: { maxUsers: 3, maxProducts: 500 } },
  { key: 'growth', name: 'Growth', monthlyPriceEur: 49, limits: { maxUsers: 15, maxProducts: 5000 } },
  { key: 'enterprise', name: 'Enterprise', monthlyPriceEur: 199, limits: { maxUsers: null, maxProducts: null } },
];

async function main() {
  for (const permission of PERMISSIONS_CATALOGUE) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      update: {
        resource: permission.resource,
        action: permission.action,
        description: permission.description,
      },
      create: permission,
    });
  }
  console.log(`Seeded ${PERMISSIONS_CATALOGUE.length} permissions.`);

  for (const plan of PLANS) {
    await prisma.plan.upsert({
      where: { key: plan.key },
      update: { name: plan.name, monthlyPriceEur: plan.monthlyPriceEur, limits: plan.limits },
      create: plan,
    });
  }
  console.log(`Seeded ${PLANS.length} plans.`);

  await seedSuperAdmin();
}

/**
 * Bootstraps exactly one Super Admin account from ENV
 * (`SUPER_ADMIN_BOOTSTRAP_EMAIL`/`SUPER_ADMIN_BOOTSTRAP_PASSWORD`) —
 * per the explicit requirement that Super Admin creation is automatic,
 * not a manual SQL insert, with credentials changeable via ENV rather than
 * hardcoded. Upsert by email: if the account already exists, ONLY updates
 * `fullName`/`active` (never the password) — otherwise every redeploy
 * would silently reset a password the Super Admin may have already
 * changed through the panel itself, which would be a real security
 * regression, not a convenience. To actually rotate the bootstrap
 * password later, change the ENV value AND set
 * `SUPER_ADMIN_BOOTSTRAP_FORCE_PASSWORD_RESET=true` for exactly one
 * deploy (see docs/deployment.md's env-var checklist).
 */
async function seedSuperAdmin() {
  const email = process.env.SUPER_ADMIN_BOOTSTRAP_EMAIL;
  const password = process.env.SUPER_ADMIN_BOOTSTRAP_PASSWORD;

  if (!email || !password) {
    console.log(
      'SUPER_ADMIN_BOOTSTRAP_EMAIL/SUPER_ADMIN_BOOTSTRAP_PASSWORD not set — skipping Super Admin bootstrap. ' +
        'Set both to create the initial Super Admin account automatically on next `prisma db seed`.',
    );
    return;
  }

  const existing = await prisma.superAdmin.findUnique({ where: { email } });
  const forceReset = process.env.SUPER_ADMIN_BOOTSTRAP_FORCE_PASSWORD_RESET === 'true';

  if (existing && !forceReset) {
    await prisma.superAdmin.update({ where: { email }, data: { active: true } });
    console.log(`Super Admin "${email}" already exists — left password untouched (active: true confirmed).`);
    return;
  }

  const passwordHash = await argon2.hash(password);
  await prisma.superAdmin.upsert({
    where: { email },
    update: { passwordHash, active: true },
    create: { email, passwordHash, fullName: 'System Administrator', active: true },
  });
  console.log(
    existing
      ? `Super Admin "${email}" password reset from SUPER_ADMIN_BOOTSTRAP_PASSWORD (forced).`
      : `Super Admin "${email}" created from SUPER_ADMIN_BOOTSTRAP_EMAIL/PASSWORD.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
