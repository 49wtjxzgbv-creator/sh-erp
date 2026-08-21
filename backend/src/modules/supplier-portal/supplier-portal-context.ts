import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CodedUnauthorizedException } from '../../common/api-exceptions';

/**
 * Populated in TWO phases (2026-08-21 P0, ADR-0012 — multi-company
 * redesign): `SupplierPortalGuard` sets only the identity fields
 * (`supplierPortalUserId`, `supplierOrganizationId`, `activeConnectionId`)
 * straight from the JWT; `companyId`/`supplierId` are deliberately NOT
 * trusted from the token anymore (a company could revoke the connection
 * mid-session) — `SupplierPortalScopeInterceptor` fills those in from a
 * LIVE `SupplierConnection` row it re-checks on every single request,
 * before this object is considered complete. Every service in this module
 * reads `companyId`/`supplierId` off this object exactly as before — they
 * just now come from a fresher, re-verified source.
 */
export interface RequestSupplierPortalUser {
  supplierPortalUserId: string;
  supplierOrganizationId: string;
  activeConnectionId: string;
  /** Set by SupplierPortalScopeInterceptor from the live SupplierConnection row — not present until after that interceptor runs. */
  companyId: string;
  /** Set by SupplierPortalScopeInterceptor from the live SupplierConnection row — not present until after that interceptor runs. */
  supplierId: string;
}

export interface SupplierPortalTokenPayload {
  sub: string;
  supplierOrganizationId: string;
  activeConnectionId: string;
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
 * Multi-company redesign (2026-08-21 P0, ADR-0012): this Guard verifies
 * the token's signature/shape ONLY — it deliberately does NOT resolve
 * `companyId`/`supplierId` (the token no longer carries them as trusted
 * claims at all). That's `SupplierPortalScopeInterceptor`'s job, via a live
 * DB re-check on every request — see its own header comment for why a
 * signed claim isn't good enough here.
 */
@Injectable()
export class SupplierPortalGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) {
      throw new CodedUnauthorizedException('SUPPLIER_PORTAL_TOKEN_MISSING', 'Missing supplier portal access token.');
    }

    const secret = process.env.SUPPLIER_PORTAL_JWT_SECRET;
    if (!secret) {
      throw new CodedUnauthorizedException(
        'SUPPLIER_PORTAL_AUTH_DISABLED',
        'SUPPLIER_PORTAL_JWT_SECRET is not configured on this server — Supplier Portal auth is disabled until it is set.',
      );
    }

    try {
      const payload = this.jwt.verify<SupplierPortalTokenPayload>(token, { secret });
      if (payload.type !== 'supplier_portal') {
        throw new Error('wrong token type');
      }
      // companyId/supplierId are intentionally absent here — set later by
      // SupplierPortalScopeInterceptor from a live, re-verified row.
      request.supplierPortalUser = {
        supplierPortalUserId: payload.sub,
        supplierOrganizationId: payload.supplierOrganizationId,
        activeConnectionId: payload.activeConnectionId,
      } as Partial<RequestSupplierPortalUser>;
      return true;
    } catch {
      throw new CodedUnauthorizedException('SUPPLIER_PORTAL_TOKEN_INVALID', 'Invalid or expired supplier portal access token.');
    }
  }
}

/** Pulls the authenticated supplier portal user off the request, set by SupplierPortalGuard + SupplierPortalScopeInterceptor. */
export const CurrentSupplierPortalUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestSupplierPortalUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.supplierPortalUser;
  },
);
