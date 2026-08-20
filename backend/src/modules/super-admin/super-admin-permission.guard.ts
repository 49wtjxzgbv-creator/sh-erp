import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CodedForbiddenException } from '../../common/api-exceptions';
import { SUPER_ADMIN_PERMISSIONS_KEY } from '../../common/decorators/super-admin-permissions.decorator';
import { RequestSuperAdmin } from './super-admin-context';

/**
 * Plain Guard, not an Interceptor — deliberately unlike the tenant side's
 * `TenantScopeInterceptor` (which has to be an Interceptor only because it
 * ALSO opens a per-request Postgres RLS transaction, see that file's own
 * header comment). Super Admin data is global/BYPASSRLS with no RLS
 * transaction to wrap `next.handle()` in, so a Guard reading
 * `request.superAdmin.permissions` (set by SuperAdminGuard, which MUST run
 * first — see `@UseGuards(SuperAdminGuard, SuperAdminPermissionGuard)`
 * ordering on the controller) is the right-sized solution.
 */
@Injectable()
export class SuperAdminPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(SUPER_ADMIN_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const admin: RequestSuperAdmin | undefined = request.superAdmin;
    const granted = new Set(admin?.permissions ?? []);
    const missing = required.filter((key) => !granted.has(key));
    if (missing.length > 0) {
      throw new CodedForbiddenException('SUPER_ADMIN_MISSING_PERMISSIONS', `Missing required permission(s): ${missing.join(', ')}.`);
    }
    return true;
  }
}
