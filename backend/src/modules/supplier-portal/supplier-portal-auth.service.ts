import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { SupplierPortalAuthPrismaService } from './supplier-portal-auth-prisma.service';
import { SupplierPortalLoginDto } from './dto/supplier-portal-login.dto';
import { SupplierPortalRefreshTokenService } from './supplier-portal-refresh-token.service';
import { CodedUnauthorizedException } from '../../common/api-exceptions';

/**
 * Genuinely separate login flow from both `AuthService` (Company Admin /
 * regular users) and `SuperAdminAuthService` — own table
 * (`SupplierPortalUser`), own token secret (`SUPPLIER_PORTAL_JWT_SECRET`).
 *
 * Refresh token added as a P0 fix (2026-08-20): originally stateless
 * (7-day access token, no refresh) on the rationale that a supplier is an
 * occasional, low-privilege external user — but that meant a reload still
 * logged them out mid-session, real friction observed in this session's
 * live testing. Now issues a `SupplierPortalRefreshToken` via
 * `SupplierPortalRefreshTokenService` (same rotation/reuse-detection shape
 * as the tenant side, ADR-0006) and shortens the access token itself
 * (`SUPPLIER_PORTAL_JWT_TTL`, 7d → 30m) since the refresh token now carries
 * the session's real length — the "occasional, low-privilege" risk
 * rationale is unchanged, just moved from "long-lived access token" to
 * "long-lived, rotating, revocable refresh token" (ADR-0011 still applies:
 * no absolute ceiling on the refresh token itself, see
 * SupplierPortalRefreshTokenService's own header comment).
 */
@Injectable()
export class SupplierPortalAuthService {
  constructor(
    private readonly prisma: SupplierPortalAuthPrismaService,
    private readonly jwt: JwtService,
    private readonly refreshTokens: SupplierPortalRefreshTokenService,
  ) {}

  async login(
    dto: SupplierPortalLoginDto,
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: string; supplierId: string; companyId: string; email: string }> {
    const portalUser = await this.prisma.supplierPortalUser.findUnique({ where: { email: dto.email } });
    if (!portalUser || !portalUser.active) {
      throw new CodedUnauthorizedException('AUTH_INVALID_CREDENTIALS', 'Invalid email or password.');
    }

    const ok = await argon2.verify(portalUser.passwordHash, dto.password);
    if (!ok) {
      throw new CodedUnauthorizedException('AUTH_INVALID_CREDENTIALS', 'Invalid email or password.');
    }

    const secret = process.env.SUPPLIER_PORTAL_JWT_SECRET;
    if (!secret) {
      throw new CodedUnauthorizedException(
        'SUPPLIER_PORTAL_AUTH_DISABLED',
        'SUPPLIER_PORTAL_JWT_SECRET is not configured on this server — Supplier Portal auth is disabled until it is set.',
      );
    }
    const expiresIn = process.env.SUPPLIER_PORTAL_JWT_TTL ?? '30m';

    const accessToken = this.jwt.sign(
      { sub: portalUser.id, supplierId: portalUser.supplierId, companyId: portalUser.companyId, type: 'supplier_portal' },
      { secret, expiresIn },
    );
    const refreshToken = await this.refreshTokens.issue(portalUser.id, portalUser.companyId);

    await this.prisma.supplierPortalUser.update({ where: { id: portalUser.id }, data: { lastLoginAt: new Date() } });

    return {
      accessToken,
      refreshToken,
      expiresIn,
      supplierId: portalUser.supplierId,
      companyId: portalUser.companyId,
      email: portalUser.email,
    };
  }

  /** Rotates a refresh token for a new access+refresh pair (mirrors `AuthService#refresh`). */
  async refresh(
    rawRefreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: string; supplierId: string; companyId: string; email: string }> {
    const rotated = await this.refreshTokens.rotate(rawRefreshToken);

    const portalUser = await this.prisma.supplierPortalUser.findUnique({ where: { id: rotated.supplierPortalUserId } });
    if (!portalUser || !portalUser.active) {
      throw new CodedUnauthorizedException('AUTH_ACCOUNT_BLOCKED', 'This supplier portal account is no longer active.');
    }

    const secret = process.env.SUPPLIER_PORTAL_JWT_SECRET;
    if (!secret) {
      throw new CodedUnauthorizedException(
        'SUPPLIER_PORTAL_AUTH_DISABLED',
        'SUPPLIER_PORTAL_JWT_SECRET is not configured on this server — Supplier Portal auth is disabled until it is set.',
      );
    }
    const expiresIn = process.env.SUPPLIER_PORTAL_JWT_TTL ?? '30m';
    const accessToken = this.jwt.sign(
      { sub: portalUser.id, supplierId: portalUser.supplierId, companyId: portalUser.companyId, type: 'supplier_portal' },
      { secret, expiresIn },
    );

    return {
      accessToken,
      refreshToken: rotated.rawToken,
      expiresIn,
      supplierId: portalUser.supplierId,
      companyId: portalUser.companyId,
      email: portalUser.email,
    };
  }

  /** Revokes the refresh token's entire rotation family — signs out every tab/device that shared this session. */
  async logout(rawRefreshToken: string): Promise<void> {
    await this.refreshTokens.revokeFamily(rawRefreshToken);
  }
}
