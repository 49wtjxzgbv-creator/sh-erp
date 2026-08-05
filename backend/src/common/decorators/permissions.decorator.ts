import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Declares which permission key(s) (from the fixed catalogue,
 * ../../modules/authorization/permissions.catalogue.ts) a route requires.
 * Enforced by PermissionsGuard. Example: `@RequirePermissions('products:write')`.
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
