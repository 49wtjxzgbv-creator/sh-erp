import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { firstValueFrom, from, Observable } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import { SupplierPortalAuthPrismaService } from './supplier-portal-auth-prisma.service';
import { CodedNotFoundException } from '../../common/api-exceptions';
import { RequestSupplierPortalUser } from './supplier-portal-context';

/**
 * The supplier-portal equivalent of `TenantScopeInterceptor`.
 *
 * Multi-company redesign (2026-08-21 P0, ADR-0012): this is now the ONE
 * place `companyId`/`supplierId` get resolved for a request — never trusted
 * from the JWT (see `SupplierPortalGuard`'s own header comment for why: a
 * company could revoke the connection mid-session, and a signed claim is
 * exactly as stale as the token's TTL regardless of how carefully a
 * "switch company" endpoint validates at switch-time). On every single
 * request this does ONE lookup, through the existing BYPASSRLS
 * `supplier_portal_auth_service` client (the same "pre-tenant-context
 * problem" login already has — determining which company a request is
 * scoped to is the job here, not something that can happen after a tenant
 * context is already open): fetch the `SupplierConnection` the token's
 * `activeConnectionId` points at, and verify —
 *   1. it actually belongs to the token's `supplierOrganizationId` (catches
 *      a forged/replayed/stale token pointing at someone else's connection),
 *   2. its `status` is still `ACTIVE` (catches a connection revoked after
 *      the token was minted — this is the actual point of doing this per
 *      request instead of only at login/switch),
 *   3. the account itself is still `active` (closes an existing, unrelated
 *      gap: today this is only checked at `/refresh`, not per request —
 *      the same class of gap `TenantScopeInterceptor` closes for
 *      `Company.status`/`User.active`).
 * A failure here is a 404 (`SUPPLIER_PORTAL_CONNECTION_NOT_FOUND`), never a
 * 403 — same "never distinguish not-yours from doesn't-exist/revoked"
 * convention `SupplierPortalService#getPurchaseOrder` already uses.
 *
 * Only after that check derives real `companyId`/`supplierId` from the
 * live row does this open the normal RLS-scoped transaction — from that
 * point on, every existing service (`SupplierPortalService`, unchanged)
 * reads `actor.companyId`/`actor.supplierId` exactly as before.
 */
@Injectable()
export class SupplierPortalScopeInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authPrisma: SupplierPortalAuthPrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const supplierPortalUser: Partial<RequestSupplierPortalUser> | undefined = request.supplierPortalUser;
    if (!supplierPortalUser) {
      // @Public() supplier-portal routes with no SupplierPortalGuard (login,
      // refresh, logout) have no supplierPortalUser and pass through untouched.
      return next.handle();
    }

    return from(
      (async () => {
        const connection = await this.authPrisma.supplierConnection.findUnique({
          where: { id: supplierPortalUser.activeConnectionId },
          include: { supplierOrganization: { include: { portalUser: true } } },
        });

        if (
          !connection ||
          connection.supplierOrganizationId !== supplierPortalUser.supplierOrganizationId ||
          connection.status !== 'ACTIVE' ||
          !connection.supplierOrganization.portalUser?.active
        ) {
          throw new CodedNotFoundException(
            'SUPPLIER_PORTAL_CONNECTION_NOT_FOUND',
            'This connection no longer exists or is not active.',
          );
        }

        // Fill in the fields the Guard deliberately left unset — every
        // downstream service reads these off the same request-scoped object.
        supplierPortalUser.companyId = connection.companyId;
        supplierPortalUser.supplierId = connection.supplierId;

        return this.prisma.runInTenantTransaction(
          { companyId: connection.companyId, userId: supplierPortalUser.supplierPortalUserId! },
          () => firstValueFrom(next.handle()),
        );
      })(),
    );
  }
}
