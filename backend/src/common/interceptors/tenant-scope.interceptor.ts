import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, from, Observable } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

/**
 * Replaces what would otherwise be a separate PermissionsGuard, and is the
 * single place that activates Postgres RLS for a request (see
 * PrismaService's own header comment for why this had to move here).
 *
 * Ordering reason this is an Interceptor and not a Guard: Nest's pipeline
 * runs Guards fully BEFORE any Interceptor. A Guard has no way to keep a
 * transaction open across "the rest of the pipeline" — it just returns
 * true/false. An Interceptor's `next.handle()` *does* represent "the rest
 * of the pipeline" as an Observable we can run inside a callback, which is
 * exactly the shape `$transaction(async (tx) => ...)` needs. So permission
 * checking (which needs a DB read of the caller's Role) has to happen in
 * here too, inside the same transaction as the eventual route handler —
 * not in an earlier Guard, which would run outside RLS and see nothing.
 *
 * Only runs its DB/permission logic for authenticated requests (`req.user`
 * set by TenantContextMiddleware); `@Public()` routes have no `req.user`
 * and pass through untouched — same "secure by default, @Public() is the
 * opt-out" posture as before.
 */
@Injectable()
export class TenantScopeInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      // No verified user — either a @Public() route (fine) or JwtAuthGuard
      // already rejected the request before we got here.
      return next.handle();
    }

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    return from(
      this.prisma.runInTenantTransaction({ companyId: user.companyId, userId: user.userId }, async (tenantDb) => {
        // Real gap found and fixed during the production-readiness audit:
        // `Company.status` existed in the schema since Phase 3 but was
        // never enforced anywhere, so a Super Admin "blocking" a company
        // (SuperAdminModule) had no actual effect on requests using an
        // already-issued access token — AuthService's own login/refresh
        // checks (identity/auth.service.ts) only stop a NEW session from
        // being minted, not an existing one from continuing until its
        // 15-minute expiry. This check closes that gap: every authenticated
        // request re-checks status, so suspension takes effect immediately,
        // not "eventually."
        const company = await tenantDb.company.findUnique({ where: { id: user.companyId } });
        if (!company || company.status !== 'ACTIVE') {
          throw new ForbiddenException('This company has been suspended. Contact support.');
        }

        // Same gap, same fix, for a Super Admin blocking an individual user
        // (UsersAdminService.setActive) rather than a whole company: the
        // block already revokes refresh tokens so no NEW access token can
        // be minted, but without this, an already-issued access token
        // would keep working for the rest of its ~15-minute lifetime.
        const requester = await tenantDb.user.findUnique({ where: { id: user.userId } });
        if (!requester || !requester.active) {
          throw new ForbiddenException('Your account has been blocked. Contact your administrator.');
        }

        if (required && required.length > 0) {
          const role = await tenantDb.role.findUnique({
            where: { id: user.roleId },
            include: { permissions: { include: { permission: true } } },
          });
          if (!role) {
            throw new ForbiddenException('Role no longer exists for this company.');
          }
          const granted = new Set(role.permissions.map((rp) => rp.permission.key));
          const missing = required.filter((key) => !granted.has(key));
          if (missing.length > 0) {
            throw new ForbiddenException(`Missing required permission(s): ${missing.join(', ')}.`);
          }
        }

        // Runs the actual route handler (and everything downstream of it)
        // inside this same RLS-activated transaction.
        return firstValueFrom(next.handle());
      }),
    );
  }
}
