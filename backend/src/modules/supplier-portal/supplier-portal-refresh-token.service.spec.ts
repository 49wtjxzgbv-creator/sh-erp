import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { SupplierPortalRefreshTokenService } from './supplier-portal-refresh-token.service';
import { SupplierPortalAuthPrismaService } from './supplier-portal-auth-prisma.service';

describe('SupplierPortalRefreshTokenService — P0 fix (2026-08-20)', () => {
  let service: SupplierPortalRefreshTokenService;
  let prisma: Record<string, any>;

  beforeEach(() => {
    prisma = {
      supplierPortalRefreshToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    service = new SupplierPortalRefreshTokenService(prisma as unknown as SupplierPortalAuthPrismaService);
  });

  describe('issue', () => {
    it('stores only a sha256 hash of the raw token, never the raw value', async () => {
      const rawToken = await service.issue('spu1', 'c1');

      expect(prisma.supplierPortalRefreshToken.create).toHaveBeenCalledTimes(1);
      const data = prisma.supplierPortalRefreshToken.create.mock.calls[0][0].data;
      expect(data.tokenHash).toBe(createHash('sha256').update(rawToken).digest('hex'));
      expect(data.tokenHash).not.toBe(rawToken);
      expect(data.companyId).toBe('c1');
    });

    it('has no absolute ceiling — pure sliding window, unlike the Super Admin refresh token', async () => {
      await service.issue('spu1', 'c1');
      const data = prisma.supplierPortalRefreshToken.create.mock.calls[0][0].data;
      expect(data.absoluteExpiresAt).toBeUndefined();
    });
  });

  describe('rotate — reuse detection (ADR-0006)', () => {
    it('rejects an unknown token', async () => {
      prisma.supplierPortalRefreshToken.findUnique.mockResolvedValue(null);
      await expect(service.rotate('unknown')).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an expired token', async () => {
      prisma.supplierPortalRefreshToken.findUnique.mockResolvedValue({
        id: 'rt1',
        supplierPortalUserId: 'spu1',
        companyId: 'c1',
        familyId: 'fam1',
        expiresAt: new Date(Date.now() - 1000),
        revokedAt: null,
      });
      await expect(service.rotate('raw')).rejects.toThrow(UnauthorizedException);
    });

    it('reusing an already-rotated (revoked) token revokes the entire family instead of just failing this request', async () => {
      prisma.supplierPortalRefreshToken.findUnique.mockResolvedValue({
        id: 'rt1',
        supplierPortalUserId: 'spu1',
        companyId: 'c1',
        familyId: 'fam1',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        revokedAt: new Date(), // already rotated away once — this is a replay
      });

      await expect(service.rotate('stolen-raw-token')).rejects.toThrow(UnauthorizedException);

      expect(prisma.supplierPortalRefreshToken.updateMany).toHaveBeenCalledWith({
        where: { familyId: 'fam1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('a valid rotation revokes the old token and creates a new one in the same family, carrying companyId forward', async () => {
      prisma.supplierPortalRefreshToken.findUnique.mockResolvedValue({
        id: 'rt1',
        supplierPortalUserId: 'spu1',
        companyId: 'c1',
        familyId: 'fam1',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        revokedAt: null,
      });

      const result = await service.rotate('raw');

      expect(result).toEqual({ rawToken: expect.any(String), supplierPortalUserId: 'spu1', companyId: 'c1' });
      expect(prisma.supplierPortalRefreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt1' },
        data: { revokedAt: expect.any(Date) },
      });
      const newData = prisma.supplierPortalRefreshToken.create.mock.calls[0][0].data;
      expect(newData.familyId).toBe('fam1');
      expect(newData.companyId).toBe('c1');
    });
  });

  describe('revokeFamily — logout', () => {
    it('revokes every non-revoked token in the family', async () => {
      prisma.supplierPortalRefreshToken.findUnique.mockResolvedValue({ id: 'rt1', familyId: 'fam1' });

      await service.revokeFamily('raw');

      expect(prisma.supplierPortalRefreshToken.updateMany).toHaveBeenCalledWith({
        where: { familyId: 'fam1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('is a safe no-op for an unknown token (idempotent logout)', async () => {
      prisma.supplierPortalRefreshToken.findUnique.mockResolvedValue(null);
      await expect(service.revokeFamily('unknown')).resolves.toBeUndefined();
      expect(prisma.supplierPortalRefreshToken.updateMany).not.toHaveBeenCalled();
    });
  });
});
