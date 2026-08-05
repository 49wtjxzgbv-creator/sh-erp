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
      user: { update: jest.fn() },
      company: { findUnique: jest.fn() },
      companyBranding: { findUnique: jest.fn() },
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
});
