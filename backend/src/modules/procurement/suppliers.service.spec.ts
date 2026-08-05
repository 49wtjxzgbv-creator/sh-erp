import { ConflictException, NotFoundException } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';

describe('SuppliersService', () => {
  let service: SuppliersService;
  let prisma: any;
  let audit: any;
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
      },
    };
    audit = { record: jest.fn() };
    service = new SuppliersService(prisma, audit);
  });

  it('findOne throws NotFoundException for a missing supplier', async () => {
    prisma.tenant.supplier.findUnique.mockResolvedValue(null);
    await expect(service.findOne(user, 's1')).rejects.toThrow(NotFoundException);
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
