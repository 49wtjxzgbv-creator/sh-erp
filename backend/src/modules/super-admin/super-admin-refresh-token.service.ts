import { Injectable } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import { SuperAdminPrismaService } from './super-admin-prisma.service';
import { CodedUnauthorizedException } from '../../common/api-exceptions';

export interface RotatedSuperAdminToken {
  rawToken: string;
  superAdminId: string;
}

/**
 * P0 fix (2026-08-20): SuperAdminAuthService.login() previously issued only
 * a bare access token — no refresh token, no DB session record at all — so
 * a page reload always logged the Super Admin out (see that service's own
 * header comment; the "re-authenticating is a single form submit" rationale
 * didn't hold up under real, sustained panel use this session). Mirrors
 * `identity/auth.service.ts`'s hash-at-rest/familyId/rotation/reuse-
 * detection shape (ADR-0006) exactly, scoped to `SuperAdminRefreshToken`
 * (global, no RLS, same as `super_admins` itself) instead of the tenant
 * `refresh_tokens` table.
 *
 * One deliberate difference from the tenant version: every Super Admin
 * session — not just an impersonated one — has a hard, non-extendable
 * `absoluteExpiresAt` ceiling (`SUPER_ADMIN_REFRESH_TTL_HOURS`, default
 * 12h), fixed at the family's creation and copied forward unchanged on
 * every rotation (same `min(slidingExpiresAt, absoluteExpiresAt)` pattern
 * `AuthService#issueTokenPair` uses for an impersonation session) — so
 * staying continuously active in the panel cannot keep a session alive
 * indefinitely.
 */
@Injectable()
export class SuperAdminRefreshTokenService {
  private readonly ttlHours = Number(process.env.SUPER_ADMIN_REFRESH_TTL_HOURS ?? 12);

  constructor(private readonly prisma: SuperAdminPrismaService) {}

  async issue(superAdminId: string, familyId: string = randomUUID()): Promise<string> {
    const rawToken = randomUUID() + randomUUID(); // 72 chars of entropy, never stored raw
    const absoluteExpiresAt = new Date(Date.now() + this.ttlHours * 60 * 60 * 1000);

    await this.prisma.superAdminRefreshToken.create({
      data: {
        superAdminId,
        tokenHash: this.hashToken(rawToken),
        familyId,
        expiresAt: absoluteExpiresAt,
        absoluteExpiresAt,
      },
    });

    return rawToken;
  }

  /**
   * Reuse detection (ADR-0006): a token that was already rotated away and
   * gets presented again is a strong signal of theft/replay — revokes the
   * entire family rather than just rejecting the one request.
   */
  async rotate(rawToken: string): Promise<RotatedSuperAdminToken> {
    const tokenHash = this.hashToken(rawToken);
    const stored = await this.prisma.superAdminRefreshToken.findUnique({ where: { tokenHash } });

    if (!stored || stored.expiresAt < new Date() || stored.absoluteExpiresAt < new Date()) {
      throw new CodedUnauthorizedException('AUTH_REFRESH_TOKEN_INVALID', 'Refresh token invalid or expired.');
    }

    if (stored.revokedAt) {
      await this.prisma.superAdminRefreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new CodedUnauthorizedException('AUTH_REFRESH_TOKEN_REVOKED', 'Refresh token has been revoked. Please sign in again.');
    }

    await this.prisma.superAdminRefreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });

    const rawNewToken = randomUUID() + randomUUID();
    const slidingExpiresAt = new Date(Date.now() + this.ttlHours * 60 * 60 * 1000);
    const expiresAt = stored.absoluteExpiresAt < slidingExpiresAt ? stored.absoluteExpiresAt : slidingExpiresAt;

    await this.prisma.superAdminRefreshToken.create({
      data: {
        superAdminId: stored.superAdminId,
        tokenHash: this.hashToken(rawNewToken),
        familyId: stored.familyId, // same family — this is a rotation, not a new session
        expiresAt,
        absoluteExpiresAt: stored.absoluteExpiresAt, // ceiling never moves
      },
    });

    return { rawToken: rawNewToken, superAdminId: stored.superAdminId };
  }

  async revokeFamily(rawToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    const stored = await this.prisma.superAdminRefreshToken.findUnique({ where: { tokenHash } });
    if (!stored) return;
    await this.prisma.superAdminRefreshToken.updateMany({
      where: { familyId: stored.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }
}
