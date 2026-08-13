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
          upsert: jest.fn(),
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

  it('findOne reshapes a supplier’s portalUser relation into a small status object', async () => {
    prisma.tenant.supplier.findUnique.mockResolvedValue({
      id: 's1',
      name: 'Acme',
      portalUser: { email: 'p@acme.test', active: true, createdAt: new Date('2026-01-01'), passwordHash: 'secret' },
    });
    const result = await service.findOne(user, 's1');
    expect(result.portalUser).toEqual({ email: 'p@acme.test', active: true, createdAt: new Date('2026-01-01') });
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('findOne reports portalUser: null when no portal account exists', async () => {
    prisma.tenant.supplier.findUnique.mockResolvedValue({ id: 's1', name: 'Acme', portalUser: null });
    const result = await service.findOne(user, 's1');
    expect(result.portalUser).toBeNull();
  });

  describe('invitePortal — Supplier Portal onboarding', () => {
    it('rejects when the supplier has no email and none was provided', async () => {
      prisma.tenant.supplier.findUnique.mockResolvedValue({ id: 's1', email: null, portalUser: null });
      await expect(service.invitePortal(user, 's1', {})).rejects.toThrow(BadRequestException);
    });

    it('rejects when the email is already used by a different supplier’s portal account', async () => {
      prisma.tenant.supplier.findUnique.mockResolvedValue({ id: 's1', email: 'shared@example.com', portalUser: null });
      prisma.tenant.supplierPortalUser.findUnique.mockResolvedValue({ supplierId: 's2', email: 'shared@example.com' });
      await expect(service.invitePortal(user, 's1', {})).rejects.toThrow(ConflictException);
    });

    it('creates a portal login, emails the temp password, and returns it once', async () => {
      prisma.tenant.supplier.findUnique.mockResolvedValue({ id: 's1', email: 'supplier@example.com', portalUser: null });
      prisma.tenant.supplierPortalUser.findUnique.mockResolvedValue(null);
      prisma.tenant.supplierPortalUser.upsert.mockResolvedValue({ email: 'supplier@example.com', active: true });

      const result = await service.invitePortal(user, 's1', {});

      expect(result.email).toBe('supplier@example.com');
      expect(result.tempPassword).toEqual(expect.any(String));
      expect(email.send).toHaveBeenCalledWith('supplier@example.com', expect.any(String), expect.stringContaining(result.tempPassword));
    });
  });

  describe('deactivatePortal', () => {
    it('rejects a supplier with no portal account', async () => {
      prisma.tenant.supplierPortalUser.findUnique.mockResolvedValue(null);
      await expect(service.deactivatePortal(user, 's1')).rejects.toThrow(NotFoundException);
    });

    it('deactivates without deleting the account', async () => {
      prisma.tenant.supplierPortalUser.findUnique.mockResolvedValue({ supplierId: 's1', email: 'supplier@example.com', active: true });
      prisma.tenant.supplierPortalUser.update.mockResolvedValue({ email: 'supplier@example.com', active: false });

      const result = await service.deactivatePortal(user, 's1');

      expect(result).toEqual({ email: 'supplier@example.com', active: false });
      expect(prisma.tenant.supplierPortalUser.update).toHaveBeenCalledWith({
        where: { supplierId: 's1' },
        data: { active: false },
      });
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
