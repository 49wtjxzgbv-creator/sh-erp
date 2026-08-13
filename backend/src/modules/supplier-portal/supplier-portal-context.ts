import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export interface RequestSupplierPortalUser {
  supplierPortalUserId: string;
  supplierId: string;
  companyId: string;
}

export interface SupplierPortalTokenPayload {
  sub: string;
  supplierId: string;
  companyId: string;
  type: 'supplier_portal'; // distinguishes this token from a regular access token or a super-admin token at a glance
}

/**
 * Same "genuinely separate auth surface" pattern as SuperAdminGuard
 * (super-admin-context.ts) and for the same reason (ADR-0011, mirroring
 * ADR-0010): a supplier's whole authorization scope is "my own purchase
 * orders", which doesn't fit RequestUser's "member of exactly one Company
 * with a Role" shape. Own JWT secret (`SUPPLIER_PORTAL_JWT_SECRET`, never
 * `JWT_ACCESS_SECRET` or `SUPER_ADMIN_JWT_SECRET`), own token `type`, fails
 * closed if the secret is unset.
 *
 * Unlike SuperAdmin, this does NOT bypass RLS — it reuses the regular
 * `.tenant` client, scoped to `companyId` from the token. That scoping is
 * activated by `SupplierPortalScopeInterceptor` (which needs `request.
 * supplierPortalUser` set by THIS guard to run first), not by this guard
 * itself — a Guard can't keep a transaction open across the rest of the
 * pipeline (see TenantScopeInterceptor's own header comment for why that's
 * an Interceptor, not a Guard, in this codebase).
 */
@Injectable()
export class SupplierPortalGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) {
      throw new UnauthorizedException('Missing supplier portal access token.');
    }

    const secret = process.env.SUPPLIER_PORTAL_JWT_SECRET;
    if (!secret) {
      throw new UnauthorizedException(
        'SUPPLIER_PORTAL_JWT_SECRET is not configured on this server — Supplier Portal auth is disabled until it is set.',
      );
    }

    try {
      const payload = this.jwt.verify<SupplierPortalTokenPayload>(token, { secret });
      if (payload.type !== 'supplier_portal') {
        throw new Error('wrong token type');
      }
      request.supplierPortalUser = {
        supplierPortalUserId: payload.sub,
        supplierId: payload.supplierId,
        companyId: payload.companyId,
      } satisfies RequestSupplierPortalUser;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired supplier portal access token.');
    }
  }
}

/** Pulls the authenticated supplier portal user off the request, set by SupplierPortalGuard. */
export const CurrentSupplierPortalUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestSupplierPortalUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.supplierPortalUser;
  },
);
