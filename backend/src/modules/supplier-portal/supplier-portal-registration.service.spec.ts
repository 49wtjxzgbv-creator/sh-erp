import { NotFoundException, UnauthorizedException, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { SupplierPortalRegistrationService } from './supplier-portal-registration.service';

/**
 * Self-service registration (2026-08-21 P1, ADR-0013). These tests cover the
 * security-critical paths the plan calls out by name: the token is the ONLY
 * authorization boundary (never distinguishing invalid/expired/consumed/
 * revoked from each other), a wrong password against an existing account
 * never leaks anything beyond "invalid credentials", and two concurrent
 * redemptions of the same token can never both succeed.
 */
describe('SupplierPortalRegistrationService', () => {
  let service: SupplierPortalRegistrationService;
  let prisma: any;
  let authService: any;
  let audit: any;
  let email: any;

  function makeTx() {
    return prisma;
  }

  beforeEach(() => {
    prisma = {
      supplierConnection: { findUnique: jest.fn(), create: jest.fn() },
      supplierPortalUser: { findUnique: jest.fn(), create: jest.fn() },
      supplierOrganization: { create: jest.fn() },
      supplierInviteToken: { findUnique: jest.fn(), updateMany: jest.fn() },
      $transaction: jest.fn((cb: any) => cb(makeTx())),
    };
    authService = { issueSession: jest.fn().mockResolvedValue({ accessToken: 'tok', refreshToken: 'rtok' }) };
    audit = { record: jest.fn() };
    email = { send: jest.fn() };
    service = new SupplierPortalRegistrationService(prisma, authService, audit, email);
  });

  const validToken = {
    id: 'tok1',
    companyId: 'co1',
    supplierId: 's1',
    consumedAt: null,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 86_400_000),
    company: { name: 'Виробник A' },
    supplier: { name: 'Постачальник X' },
  };

  describe('preview', () => {
    it('returns company/supplier name for a valid token', async () => {
      prisma.supplierInviteToken.findUnique.mockResolvedValue(validToken);
      const result = await service.preview('raw-token');
      expect(result).toEqual({ companyName: 'Виробник A', supplierName: 'Постачальник X' });
    });

    it.each([
      ['nonexistent', null],
      ['consumed', { ...validToken, consumedAt: new Date() }],
      ['revoked', { ...validToken, revokedAt: new Date() }],
      ['expired', { ...validToken, expiresAt: new Date(Date.now() - 1000) }],
    ])('rejects a %s token with the same generic 404 (never distinguished)', async (_label, tokenRow) => {
      prisma.supplierInviteToken.findUnique.mockResolvedValue(tokenRow);
      await expect(service.preview('raw-token')).rejects.toThrow(NotFoundException);
    });
  });

  describe('accept — existing account branch (password proves ownership)', () => {
    it('rejects when the target supplier already has a connection (race with a concurrent redemption or a manual invite)', async () => {
      prisma.supplierInviteToken.findUnique.mockResolvedValue(validToken);
      prisma.supplierConnection.findUnique.mockResolvedValue({ id: 'existing-conn' });

      await expect(service.accept('raw-token', { email: 'a@b.com', password: 'whatever-password' })).rejects.toThrow(NotFoundException);
      expect(prisma.supplierPortalUser.findUnique).not.toHaveBeenCalled();
    });

    it('rejects a wrong password with a generic 401 (no branch-leak)', async () => {
      const passwordHash = await argon2.hash('correct-password');
      prisma.supplierInviteToken.findUnique.mockResolvedValue(validToken);
      prisma.supplierConnection.findUnique.mockResolvedValue(null);
      prisma.supplierPortalUser.findUnique.mockResolvedValue({ id: 'pu1', supplierOrganizationId: 'org1', passwordHash });

      await expect(service.accept('raw-token', { email: 'a@b.com', password: 'wrong-password' })).rejects.toThrow(UnauthorizedException);
      expect(prisma.supplierInviteToken.updateMany).not.toHaveBeenCalled();
    });

    it('connects an existing organization to the new company on correct password, consumes the token exactly once, records an audit event, and notifies the existing account by email', async () => {
      const passwordHash = await argon2.hash('correct-password');
      prisma.supplierInviteToken.findUnique.mockResolvedValue(validToken);
      prisma.supplierConnection.findUnique.mockResolvedValue(null);
      prisma.supplierPortalUser.findUnique.mockResolvedValue({ id: 'pu1', supplierOrganizationId: 'org1', passwordHash });
      prisma.supplierInviteToken.updateMany.mockResolvedValue({ count: 1 });
      prisma.supplierConnection.create.mockResolvedValue({ id: 'conn-new' });

      const result = await service.accept('raw-token', { email: 'a@b.com', password: 'correct-password' });

      expect(prisma.supplierInviteToken.updateMany).toHaveBeenCalledWith({
        where: { id: 'tok1', consumedAt: null, revokedAt: null, expiresAt: { gt: expect.any(Date) } },
        data: { consumedAt: expect.any(Date) },
      });
      expect(prisma.supplierConnection.create).toHaveBeenCalledWith({
        data: { companyId: 'co1', supplierId: 's1', supplierOrganizationId: 'org1', status: 'ACTIVE', respondedAt: expect.any(Date) },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ companyId: 'co1', actorUserId: null, action: 'supplier.connected_via_invite_link', entityId: 'conn-new' }),
      );
      expect(email.send).toHaveBeenCalledWith('a@b.com', expect.any(String), expect.any(String));
      expect(authService.issueSession).toHaveBeenCalledWith('pu1', 'conn-new');
      expect(result).toEqual({ accessToken: 'tok', refreshToken: 'rtok' });
    });

    it('rejects when the token is consumed concurrently between validation and the atomic update (count !== 1)', async () => {
      const passwordHash = await argon2.hash('correct-password');
      prisma.supplierInviteToken.findUnique.mockResolvedValue(validToken);
      prisma.supplierConnection.findUnique.mockResolvedValue(null);
      prisma.supplierPortalUser.findUnique.mockResolvedValue({ id: 'pu1', supplierOrganizationId: 'org1', passwordHash });
      prisma.supplierInviteToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.accept('raw-token', { email: 'a@b.com', password: 'correct-password' })).rejects.toThrow(NotFoundException);
      expect(prisma.supplierConnection.create).not.toHaveBeenCalled();
    });
  });

  describe('accept — new organization branch', () => {
    it('requires organizationName when the email has no existing account', async () => {
      prisma.supplierInviteToken.findUnique.mockResolvedValue(validToken);
      prisma.supplierConnection.findUnique.mockResolvedValue(null);
      prisma.supplierPortalUser.findUnique.mockResolvedValue(null);

      await expect(service.accept('raw-token', { email: 'new@example.com', password: 'a-strong-password' })).rejects.toThrow(BadRequestException);
    });

    it('creates a new organization+portalUser+ACTIVE connection, consumes the token, and returns a session (no notification email — nothing pre-existing to notify)', async () => {
      prisma.supplierInviteToken.findUnique.mockResolvedValue(validToken);
      prisma.supplierConnection.findUnique.mockResolvedValue(null);
      prisma.supplierPortalUser.findUnique.mockResolvedValue(null);
      prisma.supplierOrganization.create.mockResolvedValue({ id: 'org-new' });
      prisma.supplierPortalUser.create.mockResolvedValue({ id: 'pu-new' });
      prisma.supplierInviteToken.updateMany.mockResolvedValue({ count: 1 });
      prisma.supplierConnection.create.mockResolvedValue({ id: 'conn-new' });

      const result = await service.accept('raw-token', { email: 'new@example.com', password: 'a-strong-password', organizationName: 'Нова Компанія' });

      expect(prisma.supplierOrganization.create).toHaveBeenCalledWith({ data: { name: 'Нова Компанія' } });
      expect(prisma.supplierConnection.create).toHaveBeenCalledWith({
        data: { companyId: 'co1', supplierId: 's1', supplierOrganizationId: 'org-new', status: 'ACTIVE', respondedAt: expect.any(Date) },
      });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'supplier.registered_via_invite_link' }));
      expect(email.send).not.toHaveBeenCalled();
      expect(authService.issueSession).toHaveBeenCalledWith('pu-new', 'conn-new');
      expect(result).toEqual({ accessToken: 'tok', refreshToken: 'rtok' });
    });

    it('translates a P2002 unique-violation on email into a conflict, not a 500', async () => {
      prisma.supplierInviteToken.findUnique.mockResolvedValue(validToken);
      prisma.supplierConnection.findUnique.mockResolvedValue(null);
      prisma.supplierPortalUser.findUnique.mockResolvedValue(null);
      prisma.supplierOrganization.create.mockResolvedValue({ id: 'org-new' });
      prisma.supplierPortalUser.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }),
      );

      await expect(
        service.accept('raw-token', { email: 'new@example.com', password: 'a-strong-password', organizationName: 'Нова Компанія' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('registerStandalone — fully self-service, no invite token, zero connections (2026-08-21 P2)', () => {
    it('creates an organization+portalUser and returns just the email, no session (nothing to scope one to yet)', async () => {
      prisma.supplierOrganization.create.mockResolvedValue({ id: 'org-standalone' });
      prisma.supplierPortalUser.create.mockResolvedValue({ id: 'pu-standalone' });

      const result = await service.registerStandalone({
        organizationName: 'Самостійний Постачальник',
        email: 'standalone@example.com',
        password: 'a-strong-password',
      });

      expect(prisma.supplierOrganization.create).toHaveBeenCalledWith({ data: { name: 'Самостійний Постачальник' } });
      expect(prisma.supplierPortalUser.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ supplierOrganizationId: 'org-standalone', email: 'standalone@example.com', active: true }),
      });
      expect(result).toEqual({ email: 'standalone@example.com' });
      expect(authService.issueSession).not.toHaveBeenCalled();
    });

    it('translates a P2002 unique-violation on email into a conflict, not a 500 (same as the invite-accept new-org branch)', async () => {
      prisma.supplierOrganization.create.mockResolvedValue({ id: 'org-standalone' });
      prisma.supplierPortalUser.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }),
      );

      await expect(
        service.registerStandalone({ organizationName: 'X', email: 'taken@example.com', password: 'a-strong-password' }),
      ).rejects.toThrow(ConflictException);
    });
  });
});
