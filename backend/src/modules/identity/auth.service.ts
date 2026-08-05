import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomUUID } from 'node:crypto';
import { AuthPrismaService } from '../../prisma/auth-prisma.service';
import { LoginDto } from './dto/login.dto';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
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
      throw new UnauthorizedException('Invalid email or password.');
    }

    await this.verifyPassword(user, dto.password);

    const company = await this.prisma.company.findUnique({ where: { slug: dto.companySlug } });
    if (!company) {
      throw new UnauthorizedException('Invalid email or password.'); // deliberately same message — don't leak slug existence
    }
    // Real gap found and fixed during the production-readiness audit:
    // `Company.status` (schema.prisma) existed since Phase 3 but was never
    // actually read anywhere — a Super Admin "blocking" a company
    // (SuperAdminModule) had no effect at all until this check existed.
    // Checked at both login AND refresh (below) — an already-issued access
    // token still expires within JWT_ACCESS_TTL regardless, but a blocked
    // company's users should not be able to mint a NEW session either way.
    if (company.status !== 'ACTIVE') {
      throw new UnauthorizedException('This company has been suspended. Contact support.');
    }

    const membership = await this.prisma.companyMembership.findUnique({
      where: { companyId_userId: { companyId: company.id, userId: user.id } },
    });
    if (!membership) {
      throw new UnauthorizedException('You do not have access to this company.');
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
      throw new NotFoundException('Company not found.');
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
      if (!ok) throw new UnauthorizedException('Invalid email or password.');
      return;
    }

    if (user.legacyPasswordHash) {
      const legacyOk = this.verifyLegacySha256(plainPassword, user.legacyPasswordHash);
      if (!legacyOk) throw new UnauthorizedException('Invalid email or password.');

      const newHash = await argon2.hash(plainPassword);
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: newHash, legacyPasswordHash: null },
      });
      return;
    }

    throw new UnauthorizedException('Invalid email or password.');
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
      throw new UnauthorizedException('Refresh token invalid or expired.');
    }

    if (stored.revokedAt) {
      // Reused a token that was already rotated away — assume compromise.
      await this.prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token has been revoked. Please sign in again.');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const company = await this.prisma.company.findUnique({ where: { id: stored.companyId } });
    if (!company || company.status !== 'ACTIVE') {
      throw new UnauthorizedException('This company has been suspended. Contact support.');
    }

    const membership = await this.prisma.companyMembership.findUnique({
      where: { companyId_userId: { companyId: stored.companyId, userId: stored.userId } },
    });
    if (!membership) {
      throw new UnauthorizedException('You no longer have access to this company.');
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: stored.userId } });

    return this.issueTokenPair(
      stored.userId,
      stored.companyId,
      user.email,
      membership.roleId,
      stored.familyId, // same family — this is a rotation, not a new session
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

  private async issueTokenPair(
    userId: string,
    companyId: string,
    email: string,
    roleId: string,
    familyId: string = randomUUID(),
  ): Promise<TokenPair> {
    const accessTtl = process.env.JWT_ACCESS_TTL ?? '15m';
    const accessToken = this.jwt.sign(
      { sub: userId, companyId, email, roleId },
      { expiresIn: accessTtl },
    );

    const rawRefreshToken = randomUUID() + randomUUID(); // 72 chars of entropy, never stored raw
    const expiresAt = new Date(Date.now() + this.refreshTtlDays * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        companyId,
        tokenHash: this.hashToken(rawRefreshToken),
        familyId,
        expiresAt,
      },
    });

    return { accessToken, refreshToken: rawRefreshToken, expiresIn: accessTtl };
  }

  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }
}
