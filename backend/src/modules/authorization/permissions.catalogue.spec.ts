import { PERMISSIONS_CATALOGUE, DEFAULT_ROLES } from './permissions.catalogue';

/**
 * Pre-production audit (2026-08-24), point 2: exact, automated answer to
 * "which default roles get finance:* after this ships" — not a guess.
 *
 * IMPORTANT caveat this test does NOT and CANNOT cover (documented, not
 * silently missing): `DEFAULT_ROLES` only seeds a NEW company's roles at
 * signup time (CompanyService.createCompany -> RolesService.seedDefaultRoles).
 * Existing companies' already-created Role rows are NOT retroactively
 * updated when this catalogue gains new keys — `prisma db seed` only
 * upserts the global `permissions` table (making the key exist/resolvable),
 * never touches any company's `RolePermission` rows. An existing company's
 * Admin can self-grant `finance:*` via the already-existing /admin/roles
 * UI once the key exists, or an explicit one-time backfill migration is
 * needed if automatic rollout to existing companies is wanted — see the
 * accompanying audit report.
 */
describe('finance permissions in the catalogue', () => {
  it('defines exactly finance:read / finance:manage / finance:delete, no more no less', () => {
    const financeKeys = PERMISSIONS_CATALOGUE.filter((p) => p.resource === 'finance').map((p) => p.key);
    expect(financeKeys.sort()).toEqual(['finance:delete', 'finance:manage', 'finance:read']);
  });

  it('every finance key has a non-empty description (surfaced in the Roles UI)', () => {
    const financeDefs = PERMISSIONS_CATALOGUE.filter((p) => p.resource === 'finance');
    for (const def of financeDefs) {
      expect(def.description.length).toBeGreaterThan(0);
    }
  });

  it('a NEW company\'s Admin role gets all 3 finance keys (DEFAULT_ROLES admin = every catalogue key)', () => {
    const admin = DEFAULT_ROLES.find((r) => r.name === 'Admin')!;
    expect(admin.permissions).toEqual(expect.arrayContaining(['finance:read', 'finance:manage', 'finance:delete']));
  });

  it('no OTHER default role gets any finance:* key (deliberately admin-only, same sensitivity class as reports:valuation)', () => {
    const nonAdminRoles = DEFAULT_ROLES.filter((r) => r.name !== 'Admin');
    for (const role of nonAdminRoles) {
      const financeGrants = role.permissions.filter((k) => k.startsWith('finance:'));
      expect(financeGrants).toEqual([]);
    }
  });

  it('there is no "Manager" role in this system at all (only Admin/Storekeeper/Production/Sales/Viewer)', () => {
    const names = DEFAULT_ROLES.map((r) => r.name);
    expect(names).toEqual(['Admin', 'Storekeeper', 'Production', 'Sales', 'Viewer']);
  });
});
