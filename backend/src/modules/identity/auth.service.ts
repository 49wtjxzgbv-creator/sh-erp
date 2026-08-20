import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomUUID } from 'node:crypto';
import { AuthPrismaService } from '../../prisma/auth-prisma.service';
import { LoginDto } from './dto/login.dto';
import { CodedNotFoundException, CodedUnauthorizedException } from '../../common/api-exceptions';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  // Set only for an impersonation-flagged session (see
  // issueImpersonationSession/refresh below) — carried through every
  // rotation in the family so the frontend can show/hide its "you are
  // impersonating X" banner on every silent refresh, not just the initial
  // handoff from the Super Admin panel.
  impersonatedBy?: string | null;
}

@Injectable()
export class AuthService {
  private readonly refreshTtlDays = Number(process.env.JWT_REFRESH_TTL_DAYS ?? 30);

  constructor(
    // AuthPrismaService, not PrismaService — see its header comment. Every
    // lookup in this file runs before a tenant/company is known, so it
    // cannot go through the RLS-activated `.tenant` client.
    private readonly prisma: AuthPrismaService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Verifies credentials, resolves which company the user is signing into,
   * and issues an access+refresh token pair scoped to that company.
   *
   * Transparent legacy password re-hash (Phase 0 decision, ADR-0006): a
   * migrated user has `passwordHash = null` and `legacyPasswordHash` set
   * (unsalted SHA-256, from the old Apps Script system). On first
   * successful login post-migration, we verify against the legacy hash,
   * then silently upgrade to argon2id and clear the legacy field — no
   * forced reset, no user-visible difference, per the owner's explicit
   * Phase 0 choice.
   */
  async login(dto: LoginDto): Promise<TokenPair & { userId: string; companyId: string }> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !user.active) {
      throw new CodedUnauthorizedException('AUTH_INVALID_CREDENTIALS', 'Invalid email or password.');
    }

    await this.verifyPassword(user, dto.password);

    const company = await this.prisma.company.findUnique({ where: { slug: dto.companySlug } });
    if (!company) {
      throw new CodedUnauthorizedException('AUTH_INVALID_CREDENTIALS', 'Invalid email or password.'); // deliberately same message — don't leak slug existence
    }
    // Real gap found and fixed during the production-readiness audit:
    // `Company.status` (schema.prisma) existed since Phase 3 but was never
    // actually read anywhere — a Super Admin "blocking" a company
    // (SuperAdminModule) had no effect at all until this check existed.
    // Checked at both login AND refresh (below) — an already-issued access
    // token still expires within JWT_ACCESS_TTL regardless, but a blocked
    // company's users should not be able to mint a NEW session either way.
    if (company.status !== 'ACTIVE') {
      throw new CodedUnauthorizedException('AUTH_COMPANY_SUSPENDED', 'This company has been suspended. Contact support.');
    }

    const membership = await this.prisma.companyMembership.findUnique({
      where: { companyId_userId: { companyId: company.id, userId: user.id } },
    });
    if (!membership) {
      throw new CodedUnauthorizedException('AUTH_NO_COMPANY_ACCESS', 'You do not have access to this company.');
    }

    const tokens = await this.issueTokenPair(user.id, company.id, user.email, membership.roleId);
    return { ...tokens, userId: user.id, companyId: company.id };
  }

  /**
   * Company discovery — the third pre-tenant-context flow the
   * `auth_service` role covers (ADR-0009), alongside login and refresh.
   * Returns just enough for a login screen to identify and brand itself
   * before the person has authenticated: basic company info + branding.
   * Mirrors Phase 1 §3.6's `getBrandingAssets`, which the legacy system
   * deliberately left un-auth-gated for the same reason. Never returns
   * anything sensitive (no user list, no settings, no financial data).
   */
  async getPublicCompanyInfo(slug: string) {
    const company = await this.prisma.company.findUnique({ where: { slug } });
    if (!company) {
      throw new CodedNotFoundException('COMPANY_NOT_FOUND', 'Company not found.');
    }
    const branding = await this.prisma.companyBranding.findUnique({ where: { companyId: company.id } });
    return {
      id: company.id,
      slug: company.slug,
      name: company.name,
      locale: company.locale,
      branding: branding ?? null,
    };
  }

  async verifyPassword(
    user: { id: string; passwordHash: string | null; legacyPasswordHash: string | null },
    plainPassword: string,
  ): Promise<void> {
    if (user.passwordHash) {
      const ok = await argon2.verify(user.passwordHash, plainPassword);
      if (!ok) throw new CodedUnauthorizedException('AUTH_INVALID_CREDENTIALS', 'Invalid email or password.');
      return;
    }

    if (user.legacyPasswordHash) {
      const legacyOk = this.verifyLegacySha256(plainPassword, user.legacyPasswordHash);
      if (!legacyOk) throw new CodedUnauthorizedException('AUTH_INVALID_CREDENTIALS', 'Invalid email or password.');

      const newHash = await argon2.hash(plainPassword);
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: newHash, legacyPasswordHash: null },
      });
      return;
    }

    throw new CodedUnauthorizedException('AUTH_INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  private verifyLegacySha256(plainPassword: string, legacyHash: string): boolean {
    const computed = createHash('sha256').update(plainPassword).digest('hex');
    return computed === legacyHash;
  }

  /**
   * Rotates a refresh token. Reuse detection (ADR-0006): every token
   * belongs to a `familyId`. If a token that was already rotated (i.e. no
   * longer the latest in its family) is presented again, that's a strong
   * signal the token was stolen and replayed — the entire family is
   * revoked, forcing re-authentication, rather than just rejecting the one
   * request.
   */
  async refresh(rawToken: string): Promise<TokenPair> {
    const tokenHash = this.hashToken(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored || stored.expiresAt < new Date()) {
      throw new CodedUnauthorizedException('AUTH_REFRESH_TOKEN_INVALID', 'Refresh token invalid or expired.');
    }

    // Impersonation ceiling: `expiresAt` itself already reflects this (see
    // issueTokenPair), so this check is redundant in the common case — kept
    // as an explicit, readable guard anyway rather than relying solely on
    // `expiresAt`'s implicit min(), since a future change to that
    // computation should not silently reopen this specific security
    // property.
    if (stored.absoluteExpiresAt && stored.absoluteExpiresAt < new Date()) {
      throw new CodedUnauthorizedException('AUTH_REFRESH_TOKEN_INVALID', 'Impersonation session has expired.');
    }

    if (stored.revokedAt) {
      // Reused a token that was already rotated away — assume compromise.
      await this.prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new CodedUnauthorizedException('AUTH_REFRESH_TOKEN_REVOKED', 'Refresh token has been revoked. Please sign in again.');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const company = await this.prisma.company.findUnique({ where: { id: stored.companyId } });
    if (!company || company.status !== 'ACTIVE') {
      throw new CodedUnauthorizedException('AUTH_COMPANY_SUSPENDED', 'This company has been suspended. Contact support.');
    }

    const membership = await this.prisma.companyMembership.findUnique({
      where: { companyId_userId: { companyId: stored.companyId, userId: stored.userId } },
    });
    if (!membership) {
      throw new CodedUnauthorizedException('AUTH_NO_COMPANY_ACCESS', 'You no longer have access to this company.');
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: stored.userId } });

    return this.issueTokenPair(
      stored.userId,
      stored.companyId,
      user.email,
      membership.roleId,
      stored.familyId, // same family — this is a rotation, not a new session
      // Propagate impersonation flag/ceiling unchanged across rotation —
      // the ceiling must never reset/extend just because the token was
      // refreshed before it expired.
      stored.impersonatedBy ? { impersonatedBy: stored.impersonatedBy, absoluteExpiresAt: stored.absoluteExpiresAt! } : undefined,
    );
  }

  async revokeFamily(rawToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored) return;
    await this.prisma.refreshToken.updateMany({
      where: { familyId: stored.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * P0 fix (2026-08-20): Super Admin's "Увійти як" previously minted an
   * access-token-only JWT with no refresh token, so the impersonated tab
   * could never pass middleware's httpOnly-refresh-cookie check. This
   * issues a REAL session through the exact same `issueTokenPair` +
   * `RefreshToken` machinery a normal login uses — same rotation, same
   * reuse detection — but flagged with `impersonatedBy` and capped by a
   * short, non-extendable `absoluteExpiresAt` ceiling
   * (IMPERSONATION_SESSION_TTL_HOURS, default 1h) so the session cannot be
   * kept alive indefinitely just by refreshing it before it expires. A
   * normal 30-day sliding refresh token would be a real security
   * regression for this purpose — this is deliberately NOT that.
   */
  async issueImpersonationSession(
    userId: string,
    companyId: string,
    email: string,
    roleId: string,
    impersonatedBy: string,
  ): Promise<TokenPair> {
    const ttlHours = Number(process.env.IMPERSONATION_SESSION_TTL_HOURS ?? 1);
    const absoluteExpiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
    return this.issueTokenPair(userId, companyId, email, roleId, undefined, {
      impersonatedBy,
      absoluteExpiresAt,
    });
  }

  private async issueTokenPair(
    userId: string,
    companyId: string,
    email: string,
    roleId: string,
    familyId: string = randomUUID(),
    impersonation?: { impersonatedBy: string; absoluteExpiresAt: Date },
  ): Promise<TokenPair> {
    const accessTtl = process.env.JWT_ACCESS_TTL ?? '15m';
    const accessToken = this.jwt.sign(
      { sub: userId, companyId, email, roleId, ...(impersonation ? { impersonatedBy: impersonation.impersonatedBy } : {}) },
      { expiresIn: accessTtl },
    );

    const rawRefreshToken = randomUUID() + randomUUID(); // 72 chars of entropy, never stored raw
    const slidingExpiresAt = new Date(Date.now() + this.refreshTtlDays * 24 * 60 * 60 * 1000);
    // The impersonation ceiling always wins over the normal 30-day sliding
    // window — this is what actually prevents "refresh forever" for an
    // impersonated session.
    const expiresAt = impersonation && impersonation.absoluteExpiresAt < slidingExpiresAt
      ? impersonation.absoluteExpiresAt
      : slidingExpiresAt;

    await this.prisma.refreshToken.create({
      data: {
        userId,
        companyId,
        tokenHash: this.hashToken(rawRefreshToken),
        familyId,
        expiresAt,
        impersonatedBy: impersonation?.impersonatedBy,
        absoluteExpiresAt: impersonation?.absoluteExpiresAt,
      },
    });

    return { accessToken, refreshToken: rawRefreshToken, expiresIn: accessTtl, impersonatedBy: impersonation?.impersonatedBy ?? null };
  }

  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }
}
