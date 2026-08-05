import { ConflictException } from '@nestjs/common';
import { CompanyService } from './company.service';

describe('CompanyService', () => {
  let service: CompanyService;
  let prisma: any;
  let rolesService: any;
  let companyUnitsService: any;
  let warehousesService: any;
  let billingService: any;
  let tx: any;

  const dto = {
    companyName: 'Acme',
    slug: 'acme',
    ownerEmail: 'owner@acme.test',
    ownerFullName: 'Owner Name',
    ownerPassword: 'correct-horse-battery-staple',
  };

  beforeEach(() => {
    tx = {
      company: { create: jest.fn(), findUnique: jest.fn() },
      user: { create: jest.fn() },
      role: { findFirstOrThrow: jest.fn().mockResolvedValue({ id: 'role-admin', name: 'Admin' }) },
      companyMembership: { create: jest.fn() },
      companySettings: { create: jest.fn() },
    };
    prisma = {
      company: { findUnique: jest.fn().mockResolvedValue(null) },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      runInTenantTransaction: jest.fn((_context: any, work: any) => work(tx)),
    };
    rolesService = { seedDefaultRoles: jest.fn() };
    companyUnitsService = { seedDefaults: jest.fn() };
    warehousesService = { seedDefault: jest.fn() };
    billingService = { seedDefaultSubscription: jest.fn() };
    service = new CompanyService(prisma, rolesService, companyUnitsService, warehousesService, billingService);

    tx.company.create.mockResolvedValue({ id: 'generated-company-id', slug: 'acme' });
    tx.user.create.mockResolvedValue({ id: 'generated-user-id', email: dto.ownerEmail });
  });

  it('rejects a taken slug before opening any transaction', async () => {
    prisma.company.findUnique.mockResolvedValue({ id: 'existing' });
    await expect(service.createCompany(dto)).rejects.toThrow(ConflictException);
    expect(prisma.runInTenantTransaction).not.toHaveBeenCalled();
  });

  it('rejects an already-registered owner email before opening any transaction', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'existing' });
    await expect(service.createCompany(dto)).rejects.toThrow(ConflictException);
    expect(prisma.runInTenantTransaction).not.toHaveBeenCalled();
  });

  it('opens the tenant transaction with a pre-generated companyId/userId, so SET LOCAL is active from the first statement', async () => {
    await service.createCompany(dto);

    const [context] = prisma.runInTenantTransaction.mock.calls[0];
    expect(context.companyId).toBeDefined();
    expect(context.userId).toBeDefined();

    // Company/User were created with those same pre-generated ids, not left to the DB default.
    expect(tx.company.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ id: context.companyId, slug: 'acme' }) }),
    );
    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ id: context.userId, email: dto.ownerEmail }) }),
    );
  });

  it('threads the same tx into every per-module seeder (roles, units, warehouse, billing)', async () => {
    await service.createCompany(dto);

    expect(rolesService.seedDefaultRoles).toHaveBeenCalledWith(tx, 'generated-company-id');
    expect(companyUnitsService.seedDefaults).toHaveBeenCalledWith(tx, 'generated-company-id');
    expect(warehousesService.seedDefault).toHaveBeenCalledWith(tx, 'generated-company-id');
    expect(billingService.seedDefaultSubscription).toHaveBeenCalledWith(tx, 'generated-company-id');
  });

  it('creates the CompanyMembership row against the seeded Admin role', async () => {
    await service.createCompany(dto);

    expect(tx.companyMembership.create).toHaveBeenCalledWith({
      data: { companyId: 'generated-company-id', userId: 'generated-user-id', roleId: 'role-admin' },
    });
  });

  it('returns the created company and owner user id', async () => {
    const result = await service.createCompany(dto);
    expect(result.company.id).toBe('generated-company-id');
    expect(result.ownerUserId).toBe('generated-user-id');
  });
});
