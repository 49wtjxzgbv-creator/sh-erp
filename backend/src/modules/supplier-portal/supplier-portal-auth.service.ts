import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { SupplierPortalAuthPrismaService } from './supplier-portal-auth-prisma.service';
import { SupplierPortalLoginDto } from './dto/supplier-portal-login.dto';
import { CodedUnauthorizedException } from '../../common/api-exceptions';

/**
 * Genuinely separate login flow from both `AuthService` (Company Admin /
 * regular users) and `SuperAdminAuthService` — own table
 * (`SupplierPortalUser`), own token secret (`SUPPLIER_PORTAL_JWT_SECRET`).
 * TTL is longer than either of those (`SUPPLIER_PORTAL_JWT_TTL`, default
 * 7d, no refresh token) — deliberately: a supplier is an occasional,
 * low-privilege external user checking on a handful of purchase orders,
 * not staff doing sustained admin work, so forcing a fresh login every
 * 15-30 minutes would be pure friction for no real security benefit (the
 * token can only ever touch that one supplier's own rows regardless of
 * how long it's valid).
 */
@Injectable()
export class SupplierPortalAuthService {
  constructor(
    private readonly prisma: SupplierPortalAuthPrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: SupplierPortalLoginDto): Promise<{ accessToken: string; expiresIn: string }> {
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
    const expiresIn = process.env.SUPPLIER_PORTAL_JWT_TTL ?? '7d';

    const accessToken = this.jwt.sign(
      { sub: portalUser.id, supplierId: portalUser.supplierId, companyId: portalUser.companyId, type: 'supplier_portal' },
      { secret, expiresIn },
    );

    await this.prisma.supplierPortalUser.update({ where: { id: portalUser.id }, data: { lastLoginAt: new Date() } });

    return { accessToken, expiresIn };
  }
}
