import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProductsService } from './products.service';

function prismaKnownError(code: string) {
  return Object.assign(new Error('prisma error'), {
    code,
    clientVersion: '5.20.0',
    name: 'PrismaClientKnownRequestError',
    __proto__: Prisma.PrismaClientKnownRequestError.prototype,
  });
}

describe('ProductsService', () => {
  let service: ProductsService;
  let prisma: any;
  let audit: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  beforeEach(() => {
    prisma = {
      tenant: {
        product: {
          create: jest.fn(),
          update: jest.fn(),
          findUnique: jest.fn(),
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
        },
      },
    };
    audit = { record: jest.fn() };
    service = new ProductsService(prisma, audit);
  });

  it('create() persists the product and logs an audit event with the created row as `after`', async () => {
    const created = { id: 'p1', article: 'ABC-1', name: 'Widget' };
    prisma.tenant.product.create.mockResolvedValue(created);

    const result = await service.create(user, { article: 'ABC-1', name: 'Widget', unitId: 'unit1' } as any);

    expect(result).toBe(created);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'product.created', entityType: 'Product', entityId: 'p1', after: created }),
    );
  });

  it('create() surfaces a duplicate article (P2002) as a friendly ConflictException', async () => {
    prisma.tenant.product.create.mockRejectedValue(prismaKnownError('P2002'));
    await expect(
      service.create(user, { article: 'DUP-1', name: 'Widget', unitId: 'unit1' } as any),
    ).rejects.toThrow(ConflictException);
  });

  it('create() surfaces a bad unit/supplier reference (P2003) as a NotFoundException naming the composite-FK cause', async () => {
    prisma.tenant.product.create.mockRejectedValue(prismaKnownError('P2003'));
    await expect(
      service.create(user, { article: 'ABC-2', name: 'Widget', unitId: 'nonexistent' } as any),
    ).rejects.toThrow(NotFoundException);
  });

  it('findOne() throws NotFoundException when the product does not exist', async () => {
    prisma.tenant.product.findUnique.mockResolvedValue(null);
    await expect(service.findOne(user, 'missing')).rejects.toThrow(NotFoundException);
  });

  it('query() excludes soft-deleted rows by default', async () => {
    await service.query(user, {});
    expect(prisma.tenant.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
    );
  });

  it('query() includes soft-deleted rows when includeDeleted is set', async () => {
    await service.query(user, { includeDeleted: true } as any);
    const where = prisma.tenant.product.findMany.mock.calls[0][0].where;
    expect(where.deletedAt).toBeUndefined();
  });

  it('query() builds a case-insensitive OR search across article and name', async () => {
    await service.query(user, { search: 'widg' });
    const where = prisma.tenant.product.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { article: { contains: 'widg', mode: 'insensitive' } },
      { name: { contains: 'widg', mode: 'insensitive' } },
    ]);
  });

  it('remove() soft-deletes (sets deletedAt) rather than hard-deleting', async () => {
    prisma.tenant.product.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.tenant.product.update.mockResolvedValue({ id: 'p1', deletedAt: new Date() });

    await service.remove(user, 'p1');

    expect(prisma.tenant.product.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { deletedAt: expect.any(Date) },
    });
  });
});
