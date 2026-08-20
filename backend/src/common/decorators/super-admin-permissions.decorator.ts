import { SetMetadata } from '@nestjs/common';

export const SUPER_ADMIN_PERMISSIONS_KEY = 'superAdminPermissions';

/**
 * Declares which Super Admin permission key(s) (from the fixed catalogue,
 * ../../modules/super-admin/super-admin-permissions.catalogue.ts) a route
 * requires. Enforced by SuperAdminPermissionGuard, which must run AFTER
 * SuperAdminGuard (it reads `request.superAdmin.permissions`, set there).
 * Example: `@RequireSuperAdminPermissions('companies:impersonate')`.
 */
export const RequireSuperAdminPermissions = (...permissions: string[]) =>
  SetMetadata(SUPER_ADMIN_PERMISSIONS_KEY, permissions);
