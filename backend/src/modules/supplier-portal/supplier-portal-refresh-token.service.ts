import { Injectable } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import { SupplierPortalAuthPrismaService } from './supplier-portal-auth-prisma.service';
import { CodedUnauthorizedException } from '../../common/api-exceptions';

export interface RotatedSupplierPortalToken {
  rawToken: string;
  supplierPortalUserId: string;
  companyId: string;
}

/**
 * P0 fix (2026-08-20): SupplierPortalAuthService.login() previously issued
 * only a bare access token — a page reload always logged the supplier out
 * (see that service's own header comment). Mirrors `identity/auth.service.ts`'s
 * hash-at-rest/familyId/rotation/reuse-detection shape (ADR-0006), scoped to
 * `SupplierPortalRefreshToken` (tenant-scoped, RLS-protected like
 * `supplier_portal_users` itself, read/written here through the same
 * pre-tenant-context BYPASSRLS `supplier_portal_auth_service` role
 * ADR-0011 already uses for the login lookup).
 *
 * Unlike the new Super Admin refresh token, this one is a PURE sliding
 * window (`SUPPLIER_PORTAL_REFRESH_TTL_DAYS`, default 30d) with no extra
 * absolute ceiling — matching this codebase's existing, deliberate "low-
 * privilege external user" risk acceptance for this surface (ADR-0011):
 * a supplier's token can only ever touch that one supplier's own rows,
 * regardless of how long the session stays alive.
 */
@Injectable()
export class SupplierPortalRefreshTokenService {
  private readonly ttlDays = Number(process.env.SUPPLIER_PORTAL_REFRESH_TTL_DAYS ?? 30);

  constructor(private readonly prisma: SupplierPortalAuthPrismaService) {}

  async issue(supplierPortalUserId: string, companyId: string, familyId: string = randomUUID()): Promise<string> {
    const rawToken = randomUUID() + randomUUID();
    const expiresAt = new Date(Date.now() + this.ttlDays * 24 * 60 * 60 * 1000);

    await this.prisma.supplierPortalRefreshToken.create({
      data: {
        supplierPortalUserId,
        companyId,
        tokenHash: this.hashToken(rawToken),
        familyId,
        expiresAt,
      },
    });

    return rawToken;
  }

  async rotate(rawToken: string): Promise<RotatedSupplierPortalToken> {
    const tokenHash = this.hashToken(rawToken);
    const stored = await this.prisma.supplierPortalRefreshToken.findUnique({ where: { tokenHash } });

    if (!stored || stored.expiresAt < new Date()) {
      throw new CodedUnauthorizedException('AUTH_REFRESH_TOKEN_INVALID', 'Refresh token invalid or expired.');
    }

    if (stored.revokedAt) {
      await this.prisma.supplierPortalRefreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new CodedUnauthorizedException('AUTH_REFRESH_TOKEN_REVOKED', 'Refresh token has been revoked. Please sign in again.');
    }

    await this.prisma.supplierPortalRefreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });

    const rawNewToken = randomUUID() + randomUUID();
    const expiresAt = new Date(Date.now() + this.ttlDays * 24 * 60 * 60 * 1000);

    await this.prisma.supplierPortalRefreshToken.create({
      data: {
        supplierPortalUserId: stored.supplierPortalUserId,
        companyId: stored.companyId,
        tokenHash: this.hashToken(rawNewToken),
        familyId: stored.familyId,
        expiresAt,
      },
    });

    return { rawToken: rawNewToken, supplierPortalUserId: stored.supplierPortalUserId, companyId: stored.companyId };
  }

  async revokeFamily(rawToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    const stored = await this.prisma.supplierPortalRefreshToken.findUnique({ where: { tokenHash } });
    if (!stored) return;
    await this.prisma.supplierPortalRefreshToken.updateMany({
      where: { familyId: stored.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }
}
