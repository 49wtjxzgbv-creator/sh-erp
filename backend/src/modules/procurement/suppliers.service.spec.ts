import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';

describe('SuppliersService', () => {
  let service: SuppliersService;
  let prisma: any;
  let audit: any;
  let email: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  beforeEach(() => {
    prisma = {
      tenant: {
        supplier: {
          create: jest.fn(),
          findUnique: jest.fn(),
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
          update: jest.fn(),
        },
        supplierPortalUser: {
          findUnique: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
        },
        supplierOrganization: {
          create: jest.fn(),
        },
        supplierConnection: {
          findUnique: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
        },
      },
    };
    audit = { record: jest.fn() };
    email = { send: jest.fn() };
    service = new SuppliersService(prisma, audit, email);
  });

  it('findOne throws NotFoundException for a missing supplier', async () => {
    prisma.tenant.supplier.findUnique.mockResolvedValue(null);
    await expect(service.findOne(user, 's1')).rejects.toThrow(NotFoundException);
  });

  it('findOne reshapes the connection -> supplierOrganization -> portalUser chain into a small status object, sourcing `active` from the CONNECTION status, not the global account flag', async () => {
    prisma.tenant.supplier.findUnique.mockResolvedValue({
      id: 's1',
      name: 'Acme',
      connection: {
        status: 'ACTIVE',
        invitedAt: new Date('2026-01-01'),
        supplierOrganization: { portalUser: { email: 'p@acme.test', passwordHash: 'secret' } },
      },
    });
    const result = await service.findOne(user, 's1');
    expect(result.portalUser).toEqual({ email: 'p@acme.test', active: true, createdAt: new Date('2026-01-01') });
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('findOne reports portalUser: null when no connection exists', async () => {
    prisma.tenant.supplier.findUnique.mockResolvedValue({ id: 's1', name: 'Acme', connection: null });
    const result = await service.findOne(user, 's1');
    expect(result.portalUser).toBeNull();
  });

  it('findOne reports active: false for a REVOKED connection (this company\'s own deactivation), even though the global account is still active', async () => {
    prisma.tenant.supplier.findUnique.mockResolvedValue({
      id: 's1',
      name: 'Acme',
      connection: {
        status: 'REVOKED',
        invitedAt: new Date('2026-01-01'),
        supplierOrganization: { portalUser: { email: 'p@acme.test' } },
      },
    });
    const result = await service.findOne(user, 's1');
    expect(result.portalUser?.active).toBe(false);
  });

  describe('invitePortal — Supplier Portal onboarding (multi-company redesign, ADR-0012)', () => {
    it('rejects when the supplier has no email and none was provided', async () => {
      prisma.tenant.supplier.findUnique.mockResolvedValue({ id: 's1', email: null, connection: null });
      await expect(service.invitePortal(user, 's1', {})).rejects.toThrow(BadRequestException);
    });

    it('case 1 — a company that already has a connection to this Supplier row resets the SAME organization\'s password, never creates a new account', async () => {
      prisma.tenant.supplier.findUnique.mockResolvedValue({
        id: 's1',
        email: 'supplier@example.com',
        connection: { id: 'conn1', status: 'ACTIVE', supplierOrganizationId: 'org1' },
      });
      prisma.tenant.supplierPortalUser.update.mockResolvedValue({ email: 'supplier@example.com' });

      const result = await service.invitePortal(user, 's1', {});

      expect(result.email).toBe('supplier@example.com');
      expect(result.tempPassword).toEqual(expect.any(String));
      expect(prisma.tenant.supplierPortalUser.update).toHaveBeenCalledWith({
        where: { supplierOrganizationId: 'org1' },
        data: expect.objectContaining({ email: 'supplier@example.com', active: true }),
      });
      expect(prisma.tenant.supplierOrganization.create).not.toHaveBeenCalled();
      expect(prisma.tenant.supplierConnection.create).not.toHaveBeenCalled();
      // Connection was already ACTIVE — no need to touch its status.
      expect(prisma.tenant.supplierConnection.update).not.toHaveBeenCalled();
    });

    it('case 1 re-activates a previously REVOKED connection for the same company (the documented "portal-invite reactivates" behavior)', async () => {
      prisma.tenant.supplier.findUnique.mockResolvedValue({
        id: 's1',
        email: 'supplier@example.com',
        connection: { id: 'conn1', status: 'REVOKED', supplierOrganizationId: 'org1' },
      });
      prisma.tenant.supplierPortalUser.update.mockResolvedValue({ email: 'supplier@example.com' });

      await service.invitePortal(user, 's1', {});

      expect(prisma.tenant.supplierConnection.update).toHaveBeenCalledWith({
        where: { id: 'conn1' },
        data: expect.objectContaining({ status: 'ACTIVE' }),
      });
    });

    it('case 2 — an email already used by a DIFFERENT company\'s connected organization creates a PENDING connection instead of erroring or duplicating the account', async () => {
      prisma.tenant.supplier.findUnique.mockResolvedValue({ id: 's1', email: 'shared@example.com', connection: null });
      prisma.tenant.supplierPortalUser.findUnique.mockResolvedValue({ supplierOrganizationId: 'org-existing', email: 'shared@example.com' });
      prisma.tenant.supplierConnection.create.mockResolvedValue({ id: 'conn-new' });

      const result = await service.invitePortal(user, 's1', {});

      expect(result).toEqual({ email: 'shared@example.com', requiresAcceptance: true });
      expect(prisma.tenant.supplierConnection.create).toHaveBeenCalledWith({
        data: { companyId: 'c1', supplierId: 's1', supplierOrganizationId: 'org-existing', status: 'PENDING' },
      });
      // No new account, no temp password — this is a connection request, not a new login.
      expect(prisma.tenant.supplierPortalUser.create).not.toHaveBeenCalled();
      expect(prisma.tenant.supplierOrganization.create).not.toHaveBeenCalled();
    });

    it('case 3 — a genuinely new supplier creates a portal login, emails the temp password once, wrapped in a new organization + one ACTIVE connection', async () => {
      prisma.tenant.supplier.findUnique.mockResolvedValue({ id: 's1', name: 'Acme', email: 'supplier@example.com', connection: null });
      prisma.tenant.supplierPortalUser.findUnique.mockResolvedValue(null);
      prisma.tenant.supplierOrganization.create.mockResolvedValue({ id: 'org-new' });
      prisma.tenant.supplierPortalUser.create.mockResolvedValue({ email: 'supplier@example.com' });

      const result = await service.invitePortal(user, 's1', {});

      expect(result.email).toBe('supplier@example.com');
      expect(result.tempPassword).toEqual(expect.any(String));
      expect(email.send).toHaveBeenCalledWith('supplier@example.com', expect.any(String), expect.stringContaining(result.tempPassword!));
      expect(prisma.tenant.supplierConnection.create).toHaveBeenCalledWith({
        data: { companyId: 'c1', supplierId: 's1', supplierOrganizationId: 'org-new', status: 'ACTIVE', respondedAt: expect.any(Date) },
      });
    });
  });

  describe('deactivatePortal — must only revoke THIS company\'s own connection (real bug fixed in the multi-company redesign)', () => {
    it('rejects a supplier with no portal connection', async () => {
      prisma.tenant.supplierConnection.findUnique.mockResolvedValue(null);
      await expect(service.deactivatePortal(user, 's1')).rejects.toThrow(NotFoundException);
    });

    it('revokes only this company\'s SupplierConnection — never the global SupplierPortalUser.active flag', async () => {
      prisma.tenant.supplierConnection.findUnique.mockResolvedValue({ id: 'conn1', status: 'ACTIVE' });
      prisma.tenant.supplierConnection.update.mockResolvedValue({ status: 'REVOKED' });

      const result = await service.deactivatePortal(user, 's1');

      expect(result).toEqual({ active: false });
      expect(prisma.tenant.supplierConnection.update).toHaveBeenCalledWith({
        where: { id: 'conn1' },
        data: { status: 'REVOKED', revokedAt: expect.any(Date) },
      });
      // The regression this test guards against: deactivating from one
      // company must never touch the shared SupplierPortalUser account —
      // that would lock the supplier out of every OTHER company too.
      expect(prisma.tenant.supplierPortalUser.update).not.toHaveBeenCalled();
    });
  });

  it('remove() soft-deletes without checking for in-use references (deliberate, Phase 1 §3.4)', async () => {
    prisma.tenant.supplier.findUnique.mockResolvedValue({ id: 's1', deletedAt: null });
    prisma.tenant.supplier.update.mockResolvedValue({ id: 's1', deletedAt: new Date() });

    await service.remove(user, 's1');

    expect(prisma.tenant.supplier.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('remove() rejects removing an already-deleted supplier', async () => {
    prisma.tenant.supplier.findUnique.mockResolvedValue({ id: 's1', deletedAt: new Date() });
    await expect(service.remove(user, 's1')).rejects.toThrow(ConflictException);
  });

  it('query() excludes soft-deleted suppliers by default', async () => {
    await service.query(user, {});
    expect(prisma.tenant.supplier.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null } }),
    );
  });
});
