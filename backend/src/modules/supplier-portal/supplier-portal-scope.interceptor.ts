import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { firstValueFrom, from, Observable } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * The supplier-portal equivalent of `TenantScopeInterceptor`, deliberately
 * much smaller: no permission/role lookup (a supplier has no `Role`), no
 * company-status/user-active check (those apply to `User`/`Company`, not
 * this actor). All it does is activate RLS for `request.supplierPortalUser.
 * companyId` (set by `SupplierPortalGuard`, which must run first) so
 * `this.prisma.tenant` works normally inside supplier-portal services —
 * every actual "only THIS supplier's own rows" narrowing happens as an
 * explicit `where: { supplierId }` in those services themselves (see
 * ADR-0011 §Consequences for why that boundary is app-layer, not a second
 * RLS session variable).
 */
@Injectable()
export class SupplierPortalScopeInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const supplierPortalUser = request.supplierPortalUser;
    if (!supplierPortalUser) {
      // @Public() supplier-portal routes (just the login endpoint) have no
      // supplierPortalUser and pass through untouched.
      return next.handle();
    }

    return from(
      this.prisma.runInTenantTransaction(
        { companyId: supplierPortalUser.companyId, userId: supplierPortalUser.supplierPortalUserId },
        () => firstValueFrom(next.handle()),
      ),
    );
  }
}
