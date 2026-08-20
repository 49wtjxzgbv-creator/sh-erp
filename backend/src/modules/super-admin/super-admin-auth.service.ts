import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { SuperAdminPrismaService } from './super-admin-prisma.service';
import { SuperAdminLoginDto } from './dto/super-admin-login.dto';
import { SuperAdminAuditService } from './super-admin-audit.service';
import { SuperAdminRefreshTokenService } from './super-admin-refresh-token.service';
import { CodedUnauthorizedException } from '../../common/api-exceptions';

/**
 * Genuinely separate login flow from `AuthService` (Company Admin / regular
 * users) — different table (`SuperAdmin`, not `User`), different token
 * secret (`SUPER_ADMIN_JWT_SECRET`, not `JWT_ACCESS_SECRET`), no company
 * context at all (no `companySlug`, no `CompanyMembership` lookup).
 *
 * Refresh token added as a P0 fix (2026-08-20): originally stateless by
 * design (see git history for the superseded rationale), but real, sustained
 * panel use showed "reload logs you out" was a genuine cost, not an accepted
 * one. Now issues a `SuperAdminRefreshToken` via `SuperAdminRefreshTokenService`
 * (same hash-at-rest/rotation/reuse-detection shape as the tenant side,
 * ADR-0006) alongside the access token — but still capped by a hard,
 * non-extendable ceiling (`SUPER_ADMIN_REFRESH_TTL_HOURS`, default 12h), so
 * this remains meaningfully different from a 30-day tenant session, not a
 * silent security regression.
 */
@Injectable()
export class SuperAdminAuthService {
  constructor(
    private readonly prisma: SuperAdminPrismaService,
    private readonly jwt: JwtService,
    private readonly superAdminAudit: SuperAdminAuditService,
    private readonly refreshTokens: SuperAdminRefreshTokenService,
  ) {}

  async login(
    dto: SuperAdminLoginDto,
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: string; permissions: string[] }> {
    const admin = await this.prisma.superAdmin.findUnique({
      where: { email: dto.email },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    if (!admin || !admin.active) {
      throw new CodedUnauthorizedException('AUTH_INVALID_CREDENTIALS', 'Invalid email or password.');
    }

    const ok = await argon2.verify(admin.passwordHash, dto.password);
    if (!ok) {
      throw new CodedUnauthorizedException('AUTH_INVALID_CREDENTIALS', 'Invalid email or password.');
    }

    const secret = process.env.SUPER_ADMIN_JWT_SECRET;
    if (!secret) {
      throw new CodedUnauthorizedException(
        'SUPER_ADMIN_AUTH_DISABLED',
        'SUPER_ADMIN_JWT_SECRET is not configured on this server — Super Admin auth is disabled until it is set.',
      );
    }
    // Lowered from the pre-refresh-token default of 30m (2026-08-20): now
    // that a silent refresh exists (SessionBoundary-equivalent on the
    // frontend calls POST .../refresh on mount), a short access-token
    // exposure window costs nothing in UX — the refresh token is what
    // actually carries the session's real length now.
    const expiresIn = process.env.SUPER_ADMIN_JWT_TTL ?? '15m';

    const accessToken = this.jwt.sign(
      { sub: admin.id, email: admin.email, type: 'super_admin' },
      { secret, expiresIn },
    );
    const refreshToken = await this.refreshTokens.issue(admin.id);

    await this.prisma.superAdmin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
    await this.superAdminAudit.record({
      superAdminId: admin.id,
      action: 'super_admin.login',
    });

    // Recomputed fresh here (not baked into the JWT) so a role change takes
    // effect on this admin's next login rather than staying stale for the
    // token's lifetime — SuperAdminGuard re-derives the same list on every
    // subsequent request for the same reason.
    const permissions = admin.role ? admin.role.permissions.map((rp) => rp.permission.key) : [];

    return { accessToken, refreshToken, expiresIn, permissions };
  }

  /**
   * Rotates a refresh token for a new access+refresh pair — the mechanism
   * that lets a reload/new tab silently restore a session instead of
   * bouncing to the login form (mirrors `AuthService#refresh`).
   */
  async refresh(
    rawRefreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: string; permissions: string[]; email: string }> {
    const rotated = await this.refreshTokens.rotate(rawRefreshToken);

    const admin = await this.prisma.superAdmin.findUnique({
      where: { id: rotated.superAdminId },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    if (!admin || !admin.active) {
      throw new CodedUnauthorizedException('AUTH_ACCOUNT_BLOCKED', 'This Super Admin account is no longer active.');
    }

    const secret = process.env.SUPER_ADMIN_JWT_SECRET;
    if (!secret) {
      throw new CodedUnauthorizedException(
        'SUPER_ADMIN_AUTH_DISABLED',
        'SUPER_ADMIN_JWT_SECRET is not configured on this server — Super Admin auth is disabled until it is set.',
      );
    }
    const expiresIn = process.env.SUPER_ADMIN_JWT_TTL ?? '15m';
    const accessToken = this.jwt.sign({ sub: admin.id, email: admin.email, type: 'super_admin' }, { secret, expiresIn });
    const permissions = admin.role ? admin.role.permissions.map((rp) => rp.permission.key) : [];

    return { accessToken, refreshToken: rotated.rawToken, expiresIn, permissions, email: admin.email };
  }

  /** Revokes the refresh token's entire rotation family — signs out every tab/device that shared this session. */
  async logout(rawRefreshToken: string): Promise<void> {
    await this.refreshTokens.revokeFamily(rawRefreshToken);
  }
}
