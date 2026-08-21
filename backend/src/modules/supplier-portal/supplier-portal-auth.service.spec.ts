import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { SupplierPortalAuthService } from './supplier-portal-auth.service';

/**
 * Multi-company redesign (2026-08-21 P0, ADR-0012). These tests cover the
 * two pieces of `SupplierPortalAuthService` the plan's test list calls out
 * that weren't already exercised elsewhere: login's default-connection
 * selection (including the migrated/legacy-account fallback path) and
 * `switchConnection`'s authorization boundary — the ONE place allowed to
 * change which company a session can reach, so it must reject a target
 * connection that isn't genuinely this organization's own ACTIVE one.
 */
describe('SupplierPortalAuthService', () => {
  let service: SupplierPortalAuthService;
  let prisma: any;
  let refreshTokens: any;
  const originalSecret = process.env.SUPPLIER_PORTAL_JWT_SECRET;

  beforeAll(() => {
    process.env.SUPPLIER_PORTAL_JWT_SECRET = 'test-secret';
  });

  afterAll(() => {
    process.env.SUPPLIER_PORTAL_JWT_SECRET = originalSecret;
  });

  beforeEach(() => {
    prisma = {
      supplierPortalUser: { findUnique: jest.fn(), update: jest.fn() },
      supplierConnection: { findUnique: jest.fn() },
    };
    refreshTokens = {
      issue: jest.fn().mockResolvedValue('raw-refresh-token'),
      rotate: jest.fn(),
      switchConnection: jest.fn(),
      peek: jest.fn(),
    };
    const jwt = { sign: jest.fn().mockReturnValue('signed.jwt.token') } as unknown as JwtService;
    service = new SupplierPortalAuthService(prisma, jwt, refreshTokens);
  });

  describe('login — default active connection selection', () => {
    async function loginWith(portalUser: any) {
      const passwordHash = await argon2.hash('correct-password');
      prisma.supplierPortalUser.findUnique.mockResolvedValue({ ...portalUser, passwordHash, active: true });
      prisma.supplierPortalUser.update.mockResolvedValue({});
      return service.login({ email: portalUser.email ?? 'supplier@example.com', password: 'correct-password' });
    }

    it('rejects an unknown email', async () => {
      prisma.supplierPortalUser.findUnique.mockResolvedValue(null);
      await expect(service.login({ email: 'nobody@example.com', password: 'x' })).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a wrong password', async () => {
      const passwordHash = await argon2.hash('the-real-password');
      prisma.supplierPortalUser.findUnique.mockResolvedValue({
        id: 'u1',
        active: true,
        passwordHash,
        supplierOrganizationId: 'org1',
        lastActiveConnectionId: null,
        supplierOrganization: { connections: [] },
      });
      await expect(service.login({ email: 'supplier@example.com', password: 'wrong' })).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an account with zero ACTIVE connections (all revoked, or none ever accepted)', async () => {
      await expect(
        loginWith({
          id: 'u1',
          supplierOrganizationId: 'org1',
          lastActiveConnectionId: null,
          supplierOrganization: { connections: [] },
        }),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'SUPPLIER_PORTAL_NO_ACTIVE_CONNECTIONS' }) });
    });

    it("defaults to lastActiveConnectionId's connection when it's still ACTIVE", async () => {
      const result = await loginWith({
        id: 'u1',
        supplierOrganizationId: 'org1',
        lastActiveConnectionId: 'conn-b',
        supplierOrganization: {
          connections: [
            { id: 'conn-a', companyId: 'co-a', supplierId: 's-a', company: { name: 'Company A' } },
            { id: 'conn-b', companyId: 'co-b', supplierId: 's-b', company: { name: 'Company B' } },
          ],
        },
      });
      expect(result.activeConnectionId).toBe('conn-b');
      expect(result.companyId).toBe('co-b');
    });

    it("falls back to the oldest ACTIVE connection for a migrated/legacy account whose lastActiveConnectionId is null (single-connection accounts behave exactly as before)", async () => {
      const result = await loginWith({
        id: 'u1',
        supplierOrganizationId: 'org1',
        lastActiveConnectionId: null,
        supplierOrganization: {
          connections: [{ id: 'conn-only', companyId: 'co-only', supplierId: 's-only', company: { name: 'Only Co' } }],
        },
      });
      expect(result.activeConnectionId).toBe('conn-only');
      expect(result.companyId).toBe('co-only');
    });

    it('falls back to the oldest ACTIVE connection when lastActiveConnectionId points at a connection that is no longer ACTIVE (revoked since last login)', async () => {
      const result = await loginWith({
        id: 'u1',
        supplierOrganizationId: 'org1',
        lastActiveConnectionId: 'conn-revoked-now-absent-from-active-list',
        supplierOrganization: {
          connections: [{ id: 'conn-a', companyId: 'co-a', supplierId: 's-a', company: { name: 'Company A' } }],
        },
      });
      expect(result.activeConnectionId).toBe('conn-a');
    });
  });

  describe('switchConnection — the one boundary allowed to change what a session can reach', () => {
    it("rejects a target connection belonging to a DIFFERENT organization (404, never distinguished from not-found)", async () => {
      refreshTokens.peek.mockResolvedValue({ supplierPortalUserId: 'u1', activeConnectionId: 'conn-a' });
      prisma.supplierPortalUser.findUnique.mockResolvedValue({ id: 'u1', active: true, supplierOrganizationId: 'org1' });
      prisma.supplierConnection.findUnique.mockResolvedValue({ id: 'conn-x', supplierOrganizationId: 'org-someone-else', status: 'ACTIVE' });

      await expect(service.switchConnection('raw-token', 'conn-x')).rejects.toThrow(NotFoundException);
      expect(refreshTokens.switchConnection).not.toHaveBeenCalled();
    });

    it('rejects a target connection of the CALLER\'S OWN organization that is PENDING (not yet accepted)', async () => {
      refreshTokens.peek.mockResolvedValue({ supplierPortalUserId: 'u1', activeConnectionId: 'conn-a' });
      prisma.supplierPortalUser.findUnique.mockResolvedValue({ id: 'u1', active: true, supplierOrganizationId: 'org1' });
      prisma.supplierConnection.findUnique.mockResolvedValue({ id: 'conn-pending', supplierOrganizationId: 'org1', status: 'PENDING' });

      await expect(service.switchConnection('raw-token', 'conn-pending')).rejects.toThrow(NotFoundException);
    });

    it('rejects a target connection of the caller\'s own organization that has been REVOKED', async () => {
      refreshTokens.peek.mockResolvedValue({ supplierPortalUserId: 'u1', activeConnectionId: 'conn-a' });
      prisma.supplierPortalUser.findUnique.mockResolvedValue({ id: 'u1', active: true, supplierOrganizationId: 'org1' });
      prisma.supplierConnection.findUnique.mockResolvedValue({ id: 'conn-revoked', supplierOrganizationId: 'org1', status: 'REVOKED' });

      await expect(service.switchConnection('raw-token', 'conn-revoked')).rejects.toThrow(NotFoundException);
    });

    it('does NOT consume/rotate the refresh token when the switch target is rejected (a failed switch must not burn the still-valid current session)', async () => {
      refreshTokens.peek.mockResolvedValue({ supplierPortalUserId: 'u1', activeConnectionId: 'conn-a' });
      prisma.supplierPortalUser.findUnique.mockResolvedValue({ id: 'u1', active: true, supplierOrganizationId: 'org1' });
      prisma.supplierConnection.findUnique.mockResolvedValue({ id: 'conn-x', supplierOrganizationId: 'org-someone-else', status: 'ACTIVE' });

      await expect(service.switchConnection('raw-token', 'conn-x')).rejects.toThrow();
      expect(refreshTokens.rotate).not.toHaveBeenCalled();
      expect(refreshTokens.switchConnection).not.toHaveBeenCalled();
    });

    it("switches successfully to the caller's own ACTIVE connection, rotates the refresh token, and remembers it as lastActiveConnectionId", async () => {
      refreshTokens.peek.mockResolvedValue({ supplierPortalUserId: 'u1', activeConnectionId: 'conn-a' });
      prisma.supplierPortalUser.findUnique
        .mockResolvedValueOnce({ id: 'u1', active: true, supplierOrganizationId: 'org1' })
        .mockResolvedValueOnce({ id: 'u1', active: true, email: 'supplier@example.com' });
      prisma.supplierConnection.findUnique
        .mockResolvedValueOnce({ id: 'conn-b', supplierOrganizationId: 'org1', status: 'ACTIVE' })
        .mockResolvedValueOnce({ id: 'conn-b', companyId: 'co-b', supplierId: 's-b', status: 'ACTIVE', company: { name: 'Company B' } });
      refreshTokens.switchConnection.mockResolvedValue({ rawToken: 'new-raw-token', supplierPortalUserId: 'u1', activeConnectionId: 'conn-b' });

      const result = await service.switchConnection('raw-token', 'conn-b');

      expect(refreshTokens.switchConnection).toHaveBeenCalledWith('raw-token', 'conn-b');
      expect(prisma.supplierPortalUser.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { lastActiveConnectionId: 'conn-b' } });
      expect(result.activeConnectionId).toBe('conn-b');
      expect(result.refreshToken).toBe('new-raw-token');
    });
  });
});
