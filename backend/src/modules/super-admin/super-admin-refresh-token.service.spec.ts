import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { SuperAdminRefreshTokenService } from './super-admin-refresh-token.service';
import { SuperAdminPrismaService } from './super-admin-prisma.service';

describe('SuperAdminRefreshTokenService — P0 fix (2026-08-20)', () => {
  let service: SuperAdminRefreshTokenService;
  let prisma: Record<string, any>;

  beforeEach(() => {
    prisma = {
      superAdminRefreshToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    service = new SuperAdminRefreshTokenService(prisma as unknown as SuperAdminPrismaService);
  });

  describe('issue', () => {
    it('stores only a sha256 hash of the raw token, never the raw value', async () => {
      const rawToken = await service.issue('sa1');

      expect(prisma.superAdminRefreshToken.create).toHaveBeenCalledTimes(1);
      const data = prisma.superAdminRefreshToken.create.mock.calls[0][0].data;
      expect(data.tokenHash).toBe(createHash('sha256').update(rawToken).digest('hex'));
      expect(data.tokenHash).not.toBe(rawToken);
    });

    it('sets expiresAt equal to absoluteExpiresAt on first issue (no separate sliding window yet)', async () => {
      await service.issue('sa1');
      const data = prisma.superAdminRefreshToken.create.mock.calls[0][0].data;
      expect(data.expiresAt).toEqual(data.absoluteExpiresAt);
    });
  });

  describe('rotate — reuse detection (ADR-0006)', () => {
    it('rejects an unknown token', async () => {
      prisma.superAdminRefreshToken.findUnique.mockResolvedValue(null);
      await expect(service.rotate('unknown')).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an expired token', async () => {
      prisma.superAdminRefreshToken.findUnique.mockResolvedValue({
        id: 'rt1',
        superAdminId: 'sa1',
        familyId: 'fam1',
        expiresAt: new Date(Date.now() - 1000),
        absoluteExpiresAt: new Date(Date.now() + 1000),
        revokedAt: null,
      });
      await expect(service.rotate('raw')).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a token past its absolute ceiling even if expiresAt itself has not passed', async () => {
      prisma.superAdminRefreshToken.findUnique.mockResolvedValue({
        id: 'rt1',
        superAdminId: 'sa1',
        familyId: 'fam1',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        absoluteExpiresAt: new Date(Date.now() - 1000),
        revokedAt: null,
      });
      await expect(service.rotate('raw')).rejects.toThrow(UnauthorizedException);
    });

    it('reusing an already-rotated (revoked) token revokes the entire family instead of just failing this request', async () => {
      prisma.superAdminRefreshToken.findUnique.mockResolvedValue({
        id: 'rt1',
        superAdminId: 'sa1',
        familyId: 'fam1',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        absoluteExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        revokedAt: new Date(), // already rotated away once — this is a replay
      });

      await expect(service.rotate('stolen-raw-token')).rejects.toThrow(UnauthorizedException);

      expect(prisma.superAdminRefreshToken.updateMany).toHaveBeenCalledWith({
        where: { familyId: 'fam1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('a valid rotation revokes the old token, creates a new one in the same family, and preserves the ceiling unchanged', async () => {
      const ceiling = new Date(Date.now() + 6 * 60 * 60 * 1000);
      prisma.superAdminRefreshToken.findUnique.mockResolvedValue({
        id: 'rt1',
        superAdminId: 'sa1',
        familyId: 'fam1',
        expiresAt: ceiling,
        absoluteExpiresAt: ceiling,
        revokedAt: null,
      });

      const result = await service.rotate('raw');

      expect(result.superAdminId).toBe('sa1');
      expect(prisma.superAdminRefreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt1' },
        data: { revokedAt: expect.any(Date) },
      });
      const newData = prisma.superAdminRefreshToken.create.mock.calls[0][0].data;
      expect(newData.familyId).toBe('fam1');
      expect(newData.absoluteExpiresAt).toEqual(ceiling); // ceiling never moves
      expect(newData.expiresAt).toEqual(ceiling); // capped by the (already-close) ceiling
    });
  });

  describe('revokeFamily — logout', () => {
    it('revokes every non-revoked token in the family', async () => {
      prisma.superAdminRefreshToken.findUnique.mockResolvedValue({ id: 'rt1', familyId: 'fam1' });

      await service.revokeFamily('raw');

      expect(prisma.superAdminRefreshToken.updateMany).toHaveBeenCalledWith({
        where: { familyId: 'fam1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('is a safe no-op for an unknown token (idempotent logout)', async () => {
      prisma.superAdminRefreshToken.findUnique.mockResolvedValue(null);
      await expect(service.revokeFamily('unknown')).resolves.toBeUndefined();
      expect(prisma.superAdminRefreshToken.updateMany).not.toHaveBeenCalled();
    });
  });
});
