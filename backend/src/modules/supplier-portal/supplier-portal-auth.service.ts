import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { SupplierPortalAuthPrismaService } from './supplier-portal-auth-prisma.service';
import { SupplierPortalLoginDto } from './dto/supplier-portal-login.dto';
import { SupplierPortalRefreshTokenService } from './supplier-portal-refresh-token.service';
import { CodedNotFoundException, CodedUnauthorizedException } from '../../common/api-exceptions';

export interface SupplierPortalSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  email: string;
  /** Display-only — the frontend shows this, but it is NEVER a trust boundary; every real request re-derives it from a live SupplierConnection row (SupplierPortalScopeInterceptor). */
  companyId: string;
  companyName: string;
  supplierId: string;
  activeConnectionId: string;
}

/**
 * Genuinely separate login flow from both `AuthService` (Company Admin /
 * regular users) and `SuperAdminAuthService` — own table
 * (`SupplierPortalUser`), own token secret (`SUPPLIER_PORTAL_JWT_SECRET`).
 *
 * Multi-company redesign (2026-08-21 P0, ADR-0012): `SupplierPortalUser` is
 * no longer 1:1 with one `Supplier`/`Company` — it belongs to a
 * `SupplierOrganization`, which can have many ACTIVE `SupplierConnection`s.
 * The access token now carries `supplierOrganizationId` + `activeConnectionId`
 * only — NOT `companyId`/`supplierId` as trusted claims (a company could
 * revoke the connection mid-session; see `SupplierPortalScopeInterceptor`'s
 * own header comment for why every request re-derives those from a live
 * row instead). `companyId`/`companyName`/`supplierId` are still returned
 * in the response body here, purely for the frontend to display — never
 * read back as an authorization claim.
 */
@Injectable()
export class SupplierPortalAuthService {
  constructor(
    private readonly prisma: SupplierPortalAuthPrismaService,
    private readonly jwt: JwtService,
    private readonly refreshTokens: SupplierPortalRefreshTokenService,
  ) {}

  async login(dto: SupplierPortalLoginDto): Promise<SupplierPortalSession> {
    const portalUser = await this.prisma.supplierPortalUser.findUnique({
      where: { email: dto.email },
      include: {
        supplierOrganization: {
          include: {
            // Standalone self-registration (2026-08-21 P2) means this
            // account can exist with zero connections of any status —
            // PENDING ones are included here (not just ACTIVE) so a
            // freshly-found-but-not-yet-accepted account can still log in
            // and see/accept the request. `SupplierPortalScopeInterceptor`
            // still 404s purchase-orders for a non-ACTIVE activeConnectionId
            // (unchanged) — only the connections list/accept/decline
            // surface (guarded by SupplierPortalGuard alone) needs to work
            // pre-acceptance, and it only reads supplierOrganizationId.
            connections: {
              where: { status: { in: ['ACTIVE', 'PENDING'] } },
              orderBy: { createdAt: 'asc' },
              include: { company: { select: { name: true } } },
            },
          },
        },
      },
    });
    if (!portalUser || !portalUser.active) {
      throw new CodedUnauthorizedException('AUTH_INVALID_CREDENTIALS', 'Invalid email or password.');
    }

    const ok = await argon2.verify(portalUser.passwordHash, dto.password);
    if (!ok) {
      throw new CodedUnauthorizedException('AUTH_INVALID_CREDENTIALS', 'Invalid email or password.');
    }

    const connections = portalUser.supplierOrganization.connections;
    if (connections.length === 0) {
      throw new CodedUnauthorizedException(
        'SUPPLIER_PORTAL_NO_ACTIVE_CONNECTIONS',
        'This account has no company connections yet — wait for a company to find you and send a connection request, or contact the company that invited you.',
      );
    }
    // Remembers which company they were last working in (re-validated
    // against the live list every login, never trusted blindly) — prefers
    // an ACTIVE connection (lastActiveConnectionId if it's still ACTIVE,
    // else the oldest ACTIVE one); with zero ACTIVE connections, falls back
    // to the oldest PENDING one (`connections` is already ordered by
    // createdAt asc, and every entry left is PENDING once activeConnections
    // is empty) purely so there's a real connection id for the token to
    // carry — the interceptor's own ACTIVE check is what actually keeps
    // purchase-order data locked until this gets accepted.
    const activeConnections = connections.filter((c) => c.status === 'ACTIVE');
    const chosen = activeConnections.find((c) => c.id === portalUser.lastActiveConnectionId) ?? activeConnections[0] ?? connections[0];

    const secret = process.env.SUPPLIER_PORTAL_JWT_SECRET;
    if (!secret) {
      throw new CodedUnauthorizedException(
        'SUPPLIER_PORTAL_AUTH_DISABLED',
        'SUPPLIER_PORTAL_JWT_SECRET is not configured on this server — Supplier Portal auth is disabled until it is set.',
      );
    }
    const expiresIn = process.env.SUPPLIER_PORTAL_JWT_TTL ?? '30m';

    const accessToken = this.jwt.sign(
      { sub: portalUser.id, supplierOrganizationId: portalUser.supplierOrganizationId, activeConnectionId: chosen.id, type: 'supplier_portal' },
      { secret, expiresIn },
    );
    const refreshToken = await this.refreshTokens.issue(portalUser.id, chosen.id);

    await this.prisma.supplierPortalUser.update({
      where: { id: portalUser.id },
      data: { lastLoginAt: new Date(), lastActiveConnectionId: chosen.id },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn,
      email: portalUser.email,
      companyId: chosen.companyId,
      companyName: chosen.company.name,
      supplierId: chosen.supplierId,
      activeConnectionId: chosen.id,
    };
  }

  /** Rotates a refresh token for a new access+refresh pair, carrying the active connection forward unchanged (mirrors `AuthService#refresh`). */
  async refresh(rawRefreshToken: string): Promise<SupplierPortalSession> {
    const rotated = await this.refreshTokens.rotate(rawRefreshToken);
    return this.reissueAccessToken(rotated.supplierPortalUserId, rotated.activeConnectionId, rotated.rawToken);
  }

  /**
   * Switches this session's active company — mints a new access+refresh
   * pair (same family) scoped to a DIFFERENT connection, without requiring
   * a fresh login. Re-verifies the target connection belongs to the SAME
   * organization and is ACTIVE before switching — never trusts the
   * frontend's own selector; this is the actual authorization boundary for
   * "which companies can this session ever reach."
   */
  async switchConnection(rawRefreshToken: string, targetConnectionId: string): Promise<SupplierPortalSession> {
    // Peek at the current token's owner WITHOUT consuming it yet — if the
    // target connection turns out to be invalid, the original token must
    // stay usable (don't burn a valid session on a rejected switch attempt).
    const stored = await this.refreshTokens.peek(rawRefreshToken);

    const portalUser = await this.prisma.supplierPortalUser.findUnique({ where: { id: stored.supplierPortalUserId } });
    if (!portalUser || !portalUser.active) {
      throw new CodedUnauthorizedException('AUTH_ACCOUNT_BLOCKED', 'This supplier portal account is no longer active.');
    }

    const target = await this.prisma.supplierConnection.findUnique({ where: { id: targetConnectionId } });
    // Same "never distinguish not-yours from doesn't-exist/revoked" rule
    // SupplierPortalService#getPurchaseOrder already uses — a connection
    // belonging to someone else's organization, or not ACTIVE, looks
    // identical to a nonexistent id from the caller's point of view.
    if (!target || target.supplierOrganizationId !== portalUser.supplierOrganizationId || target.status !== 'ACTIVE') {
      throw new CodedNotFoundException('SUPPLIER_PORTAL_CONNECTION_NOT_FOUND', 'This connection is not available to switch to.');
    }

    const rotated = await this.refreshTokens.switchConnection(rawRefreshToken, target.id);

    await this.prisma.supplierPortalUser.update({ where: { id: portalUser.id }, data: { lastActiveConnectionId: target.id } });

    return this.reissueAccessToken(rotated.supplierPortalUserId, rotated.activeConnectionId, rotated.rawToken);
  }

  /** Revokes the refresh token's entire rotation family — signs out every tab/device that shared this session. */
  async logout(rawRefreshToken: string): Promise<void> {
    await this.refreshTokens.revokeFamily(rawRefreshToken);
  }

  /**
   * Mints a brand-new session (access+refresh pair) for an already-verified
   * supplierPortalUserId+activeConnectionId — used by
   * `SupplierPortalRegistrationService` after a successful invite-link
   * redemption, where identity was already established by other means
   * (password verification against an existing account, or a
   * freshly-created one) rather than through `login()`'s own credential
   * check. Reuses `reissueAccessToken`, which re-fetches and re-verifies
   * both rows fresh from the database — the same safety net every other
   * session-minting path in this service already gets for free.
   */
  async issueSession(supplierPortalUserId: string, activeConnectionId: string): Promise<SupplierPortalSession> {
    const rawRefreshToken = await this.refreshTokens.issue(supplierPortalUserId, activeConnectionId);
    return this.reissueAccessToken(supplierPortalUserId, activeConnectionId, rawRefreshToken);
  }

  private async reissueAccessToken(supplierPortalUserId: string, activeConnectionId: string, freshRawRefreshToken: string): Promise<SupplierPortalSession> {
    const portalUser = await this.prisma.supplierPortalUser.findUnique({ where: { id: supplierPortalUserId } });
    if (!portalUser || !portalUser.active) {
      throw new CodedUnauthorizedException('AUTH_ACCOUNT_BLOCKED', 'This supplier portal account is no longer active.');
    }

    const connection = await this.prisma.supplierConnection.findUnique({
      where: { id: activeConnectionId },
      include: { company: { select: { name: true } } },
    });
    if (!connection || connection.status !== 'ACTIVE') {
      throw new CodedNotFoundException('SUPPLIER_PORTAL_CONNECTION_NOT_FOUND', 'This connection is no longer active.');
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
      { sub: portalUser.id, supplierOrganizationId: portalUser.supplierOrganizationId, activeConnectionId: connection.id, type: 'supplier_portal' },
      { secret, expiresIn },
    );

    return {
      accessToken,
      refreshToken: freshRawRefreshToken,
      expiresIn,
      email: portalUser.email,
      companyId: connection.companyId,
      companyName: connection.company.name,
      supplierId: connection.supplierId,
      activeConnectionId: connection.id,
    };
  }
}
