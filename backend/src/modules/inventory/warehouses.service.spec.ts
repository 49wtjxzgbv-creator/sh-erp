import { ConflictException } from '@nestjs/common';
import { WarehousesService, DEFAULT_WAREHOUSE_NAME } from './warehouses.service';

describe('WarehousesService', () => {
  let service: WarehousesService;
  let prisma: any;
  let audit: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  beforeEach(() => {
    prisma = {
      tenant: {
        warehouse: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
        warehouseStock: { count: jest.fn() },
      },
    };
    audit = { record: jest.fn() };
    service = new WarehousesService(prisma, audit);
  });

  it('seedDefault() creates one isDefault=true warehouse named per the legacy convention', async () => {
    // seedDefault() checks for an already-existing default first (idempotent
    // reseed) before creating one — findFirst must resolve `null` here so
    // the create() branch is the one under test.
    const tx = { warehouse: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() } };
    await service.seedDefault(tx as any, 'c1');
    expect(tx.warehouse.create).toHaveBeenCalledWith({
      data: { companyId: 'c1', name: DEFAULT_WAREHOUSE_NAME, isDefault: true },
    });
  });

  it('seedDefault() is idempotent — returns the existing default instead of creating a duplicate', async () => {
    const existing = { id: 'w1', companyId: 'c1', isDefault: true };
    const tx = { warehouse: { findFirst: jest.fn().mockResolvedValue(existing), create: jest.fn() } };
    const result = await service.seedDefault(tx as any, 'c1');
    expect(result).toBe(existing);
    expect(tx.warehouse.create).not.toHaveBeenCalled();
  });

  it('create() with isDefault=true clears any existing default first', async () => {
    prisma.tenant.warehouse.create.mockResolvedValue({ id: 'w2', isDefault: true });
    await service.create(user, { name: 'Secondary', isDefault: true });
    expect(prisma.tenant.warehouse.updateMany).toHaveBeenCalledWith({
      where: { isDefault: true },
      data: { isDefault: false },
    });
  });

  it('remove() rejects when the warehouse still holds nonzero stock', async () => {
    prisma.tenant.warehouse.findUnique.mockResolvedValue({ id: 'w1' });
    prisma.tenant.warehouseStock.count.mockResolvedValue(2);
    await expect(service.remove(user, 'w1')).rejects.toThrow(ConflictException);
    expect(prisma.tenant.warehouse.update).not.toHaveBeenCalled();
  });

  it('remove() succeeds (soft delete) when stock is zero everywhere', async () => {
    prisma.tenant.warehouse.findUnique.mockResolvedValue({ id: 'w1' });
    prisma.tenant.warehouseStock.count.mockResolvedValue(0);
    prisma.tenant.warehouse.update.mockResolvedValue({ id: 'w1', deletedAt: new Date() });

    await service.remove(user, 'w1');

    expect(prisma.tenant.warehouse.update).toHaveBeenCalledWith({
      where: { id: 'w1' },
      data: { deletedAt: expect.any(Date) },
    });
  });
});
