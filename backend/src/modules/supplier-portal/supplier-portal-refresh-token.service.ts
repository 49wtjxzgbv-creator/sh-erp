import { Injectable } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import { SupplierPortalAuthPrismaService } from './supplier-portal-auth-prisma.service';
import { CodedUnauthorizedException } from '../../common/api-exceptions';

export interface RotatedSupplierPortalToken {
  rawToken: string;
  supplierPortalUserId: string;
  activeConnectionId: string | null;
}

/**
 * P0 fix (2026-08-20): SupplierPortalAuthService.login() previously issued
 * only a bare access token — a page reload always logged the supplier out
 * (see that service's own header comment). Mirrors `identity/auth.service.ts`'s
 * hash-at-rest/familyId/rotation/reuse-detection shape (ADR-0006), scoped to
 * `SupplierPortalRefreshToken`.
 *
 * Multi-company redesign (2026-08-21 P0, ADR-0012): `companyId` is gone —
 * a session's active company can now change mid-life. `activeConnectionId`
 * replaces it: `rotate()` (plain `/refresh`) carries it forward UNCHANGED,
 * same "propagate unchanged through rotation" pattern as
 * `RefreshToken.impersonatedBy` in `identity/auth.service.ts`; only
 * `switchConnection()` (the new `/switch-connection` endpoint) changes it.
 * This table is now global (no RLS, no companyId column at all) — same
 * shape as `super_admin_refresh_tokens` — read/written exclusively through
 * the BYPASSRLS `supplier_portal_auth_service` role, as before.
 *
 * Still a PURE sliding window (`SUPPLIER_PORTAL_REFRESH_TTL_DAYS`, default
 * 30d) with no extra absolute ceiling — matching this codebase's existing,
 * deliberate "low-privilege external user" risk acceptance for this
 * surface (ADR-0011): whichever connection is active, that connection's
 * own `status` check (SupplierPortalScopeInterceptor, every request) is
 * what actually bounds what the session can reach — not the refresh
 * token's lifetime.
 */
@Injectable()
export class SupplierPortalRefreshTokenService {
  private readonly ttlDays = Number(process.env.SUPPLIER_PORTAL_REFRESH_TTL_DAYS ?? 30);

  constructor(private readonly prisma: SupplierPortalAuthPrismaService) {}

  async issue(supplierPortalUserId: string, activeConnectionId: string | null, familyId: string = randomUUID()): Promise<string> {
    const rawToken = randomUUID() + randomUUID();
    const expiresAt = new Date(Date.now() + this.ttlDays * 24 * 60 * 60 * 1000);

    await this.prisma.supplierPortalRefreshToken.create({
      data: {
        supplierPortalUserId,
        activeConnectionId,
        tokenHash: this.hashToken(rawToken),
        familyId,
        expiresAt,
      },
    });

    return rawToken;
  }

  /** Reuse detection (ADR-0006): a token that was already rotated away and gets presented again revokes the entire family, not just this one request. */
  async rotate(rawToken: string): Promise<RotatedSupplierPortalToken> {
    const stored = await this.consumeAndRevoke(rawToken);
    return this.issueNext(stored.supplierPortalUserId, stored.familyId, stored.activeConnectionId);
  }

  /**
   * Same rotation as `rotate()`, but deliberately changes `activeConnectionId`
   * instead of carrying the old one forward — the ONE place in this
   * service that's allowed to do that. The caller (SupplierPortalAuthService
   * #switchConnection) is responsible for having already verified the new
   * connection belongs to this supplier's organization and is ACTIVE —
   * this method just persists the switch.
   */
  async switchConnection(rawToken: string, newActiveConnectionId: string): Promise<RotatedSupplierPortalToken> {
    const stored = await this.consumeAndRevoke(rawToken);
    return this.issueNext(stored.supplierPortalUserId, stored.familyId, newActiveConnectionId);
  }

  /**
   * Validates a raw refresh token WITHOUT consuming/rotating it — used by
   * `SupplierPortalAuthService#switchConnection` to identify the caller
   * before deciding whether the requested switch is even allowed. If the
   * target connection turns out to be invalid, the original token must
   * stay usable (a rejected switch attempt must not burn a valid session).
   */
  async peek(rawToken: string): Promise<{ supplierPortalUserId: string; activeConnectionId: string | null }> {
    const tokenHash = this.hashToken(rawToken);
    const stored = await this.prisma.supplierPortalRefreshToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.expiresAt < new Date() || stored.revokedAt) {
      throw new CodedUnauthorizedException('AUTH_REFRESH_TOKEN_INVALID', 'Refresh token invalid, expired, or revoked.');
    }
    return { supplierPortalUserId: stored.supplierPortalUserId, activeConnectionId: stored.activeConnectionId };
  }

  private async consumeAndRevoke(rawToken: string) {
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
    return stored;
  }

  private async issueNext(supplierPortalUserId: string, familyId: string, activeConnectionId: string | null): Promise<RotatedSupplierPortalToken> {
    const rawNewToken = randomUUID() + randomUUID();
    const expiresAt = new Date(Date.now() + this.ttlDays * 24 * 60 * 60 * 1000);

    await this.prisma.supplierPortalRefreshToken.create({
      data: {
        supplierPortalUserId,
        activeConnectionId,
        tokenHash: this.hashToken(rawNewToken),
        familyId, // same family — this is a rotation, not a new session
        expiresAt,
      },
    });

    return { rawToken: rawNewToken, supplierPortalUserId, activeConnectionId };
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
