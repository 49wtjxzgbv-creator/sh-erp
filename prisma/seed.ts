// Global seed — run once per environment (`npm run prisma:seed` from
// backend/), NOT per company. Seeds:
//  - the fixed Permission catalogue (Phase 2 §6, Phase 3 §7) that
//    RolesService.seedDefaultRoles (backend/src/modules/authorization/
//    roles.service.ts) reads from when a new company signs up.
//  - the billing stub's Plan tiers (Module 12, Phase 0: "architecture
//    ready, Stripe integration not implemented yet") — `starter` is what
//    BillingService.seedDefaultSubscription assigns every new company by
//    default at signup.
//
// Per-company seeding (default roles, warehouse, units, production stages,
// QC checklist, VAT rate, subscription) happens at signup time in
// CompanyService, not here — see backend/src/modules/tenancy/company.service.ts.
import { PrismaClient } from '@prisma/client';
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
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
