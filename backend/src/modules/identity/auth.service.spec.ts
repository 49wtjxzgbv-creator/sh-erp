import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { AuthPrismaService } from '../../prisma/auth-prisma.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: Record<string, any>;

  beforeEach(() => {
    prisma = {
      user: { update: jest.fn(), findUniqueOrThrow: jest.fn() },
      company: { findUnique: jest.fn() },
      companyBranding: { findUnique: jest.fn() },
      companyMembership: { findUnique: jest.fn() },
      refreshToken: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      // Prisma's real shapes — modeled loosely since this is a unit test of
      // AuthService's logic, not an integration test of Prisma itself
      // (that's what test:e2e against a real Postgres is for).
    };
    const jwt = { sign: jest.fn().mockReturnValue('signed.jwt.token') } as unknown as JwtService;
    service = new AuthService(prisma as unknown as AuthPrismaService, jwt);
  });

  describe('verifyPassword — transparent legacy re-hash (Phase 0 / ADR-0006)', () => {
    it('accepts a correct argon2 password and does not touch legacyPasswordHash', async () => {
      const passwordHash = await argon2.hash('correct horse battery staple');
      const user = { id: 'u1', passwordHash, legacyPasswordHash: null };

      await expect(service.verifyPassword(user, 'correct horse battery staple')).resolves.toBeUndefined();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects an incorrect argon2 password', async () => {
      const passwordHash = await argon2.hash('the-real-password');
      const user = { id: 'u1', passwordHash, legacyPasswordHash: null };

      await expect(service.verifyPassword(user, 'wrong-password')).rejects.toThrow(UnauthorizedException);
    });

    it('accepts a correct legacy SHA-256 password and silently re-hashes to argon2', async () => {
      const legacyPasswordHash = createHash('sha256').update('old-system-password').digest('hex');
      const user = { id: 'u1', passwordHash: null, legacyPasswordHash };

      await service.verifyPassword(user, 'old-system-password');

      expect(prisma.user.update).toHaveBeenCalledTimes(1);
      const call = prisma.user.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'u1' });
      expect(call.data.legacyPasswordHash).toBeNull();
      // The new hash must actually verify against the same plaintext —
      // guards against a re-hash bug that stores garbage and silently
      // locks the user out next login.
      await expect(argon2.verify(call.data.passwordHash, 'old-system-password')).resolves.toBe(true);
    });

    it('rejects an incorrect legacy password and does not re-hash anything', async () => {
      const legacyPasswordHash = createHash('sha256').update('old-system-password').digest('hex');
      const user = { id: 'u1', passwordHash: null, legacyPasswordHash };

      await expect(service.verifyPassword(user, 'wrong-guess')).rejects.toThrow(UnauthorizedException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a user with neither passwordHash nor legacyPasswordHash set', async () => {
      const user = { id: 'u1', passwordHash: null, legacyPasswordHash: null };
      await expect(service.verifyPassword(user, 'anything')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('getPublicCompanyInfo — pre-login company discovery (ADR-0009)', () => {
    it('throws NotFoundException for an unknown slug', async () => {
      prisma.company.findUnique.mockResolvedValue(null);
      await expect(service.getPublicCompanyInfo('nope')).rejects.toThrow(NotFoundException);
    });

    it('returns company info + branding when both exist', async () => {
      prisma.company.findUnique.mockResolvedValue({ id: 'c1', slug: 'acme', name: 'Acme', locale: 'uk' });
      prisma.companyBranding.findUnique.mockResolvedValue({ companyId: 'c1', logoUrl: 'https://example.com/logo.png' });

      const result = await service.getPublicCompanyInfo('acme');

      expect(result).toEqual({
        id: 'c1',
        slug: 'acme',
        name: 'Acme',
        locale: 'uk',
        branding: { companyId: 'c1', logoUrl: 'https://example.com/logo.png' },
      });
    });

    it('returns branding: null when no branding row exists yet, rather than throwing', async () => {
      prisma.company.findUnique.mockResolvedValue({ id: 'c1', slug: 'acme', name: 'Acme', locale: 'uk' });
      prisma.companyBranding.findUnique.mockResolvedValue(null);

      const result = await service.getPublicCompanyInfo('acme');
      expect(result.branding).toBeNull();
    });

    it('never includes user, settings, or financial data in the response shape', async () => {
      prisma.company.findUnique.mockResolvedValue({ id: 'c1', slug: 'acme', name: 'Acme', locale: 'uk' });
      prisma.companyBranding.findUnique.mockResolvedValue(null);

      const result = await service.getPublicCompanyInfo('acme');
      expect(Object.keys(result).sort()).toEqual(['branding', 'id', 'locale', 'name', 'slug']);
    });
  });

  describe('issueImpersonationSession — P0 fix (2026-08-20)', () => {
    it('persists impersonatedBy and a computed absoluteExpiresAt ceiling on the refresh token row', async () => {
      const before = Date.now();
      await service.issueImpersonationSession('u1', 'c1', 'user@acme.com', 'role1', 'super-admin-1');

      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
      const data = prisma.refreshToken.create.mock.calls[0][0].data;
      expect(data.impersonatedBy).toBe('super-admin-1');
      expect(data.absoluteExpiresAt).toBeInstanceOf(Date);
      // Default IMPERSONATION_SESSION_TTL_HOURS is 1h — well under the
      // normal 30-day sliding window, confirming the short ceiling actually
      // won the min() in issueTokenPair, not the 30-day default.
      const hoursAhead = (data.absoluteExpiresAt.getTime() - before) / (60 * 60 * 1000);
      expect(hoursAhead).toBeGreaterThan(0);
      expect(hoursAhead).toBeLessThanOrEqual(1.01);
      expect(data.expiresAt).toEqual(data.absoluteExpiresAt);
    });

    it('returns impersonatedBy in the token pair response', async () => {
      const result = await service.issueImpersonationSession('u1', 'c1', 'user@acme.com', 'role1', 'super-admin-1');
      expect(result.impersonatedBy).toBe('super-admin-1');
    });
  });

  describe('refresh — impersonation ceiling + propagation (P0 fix, 2026-08-20)', () => {
    it('rejects a refresh once the absolute ceiling has passed, even if expiresAt itself has not', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt1',
        userId: 'u1',
        companyId: 'c1',
        familyId: 'fam1',
        // expiresAt still in the future — only the impersonation ceiling
        // should be what rejects this, proving the ceiling is enforced
        // independently of the token's own sliding expiry.
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        absoluteExpiresAt: new Date(Date.now() - 1000),
        revokedAt: null,
        impersonatedBy: 'super-admin-1',
      });

      await expect(service.refresh('raw-token')).rejects.toThrow(UnauthorizedException);
      // Must reject before ever touching revocation/company/membership state.
      expect(prisma.refreshToken.update).not.toHaveBeenCalled();
    });

    it('propagates impersonatedBy/absoluteExpiresAt unchanged across a rotation within the ceiling', async () => {
      const ceiling = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes still left
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt1',
        userId: 'u1',
        companyId: 'c1',
        familyId: 'fam1',
        expiresAt: ceiling,
        absoluteExpiresAt: ceiling,
        revokedAt: null,
        impersonatedBy: 'super-admin-1',
      });
      prisma.company.findUnique.mockResolvedValue({ id: 'c1', status: 'ACTIVE' });
      prisma.companyMembership.findUnique.mockResolvedValue({ roleId: 'role1' });
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'u1', email: 'user@acme.com' });

      const result = await service.refresh('raw-token');

      expect(result.impersonatedBy).toBe('super-admin-1');
      const newTokenData = prisma.refreshToken.create.mock.calls[0][0].data;
      expect(newTokenData.familyId).toBe('fam1'); // same family — rotation, not a new session
      expect(newTokenData.impersonatedBy).toBe('super-admin-1');
      expect(newTokenData.absoluteExpiresAt).toEqual(ceiling); // ceiling never moves on rotation
      expect(newTokenData.expiresAt).toEqual(ceiling); // capped by the ceiling, not a fresh 30-day window
    });

    it('a normal (non-impersonated) refresh is unaffected by the ceiling logic', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt1',
        userId: 'u1',
        companyId: 'c1',
        familyId: 'fam1',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        absoluteExpiresAt: null,
        revokedAt: null,
        impersonatedBy: null,
      });
      prisma.company.findUnique.mockResolvedValue({ id: 'c1', status: 'ACTIVE' });
      prisma.companyMembership.findUnique.mockResolvedValue({ roleId: 'role1' });
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'u1', email: 'user@acme.com' });

      const result = await service.refresh('raw-token');

      expect(result.impersonatedBy).toBeNull();
      const newTokenData = prisma.refreshToken.create.mock.calls[0][0].data;
      expect(newTokenData.impersonatedBy).toBeUndefined();
      expect(newTokenData.absoluteExpiresAt).toBeUndefined();
    });
  });
});
