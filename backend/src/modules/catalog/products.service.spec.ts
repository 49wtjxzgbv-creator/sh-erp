import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProductsService } from './products.service';

function prismaKnownError(code: string) {
  // `{ __proto__: X }` as an OBJECT-LITERAL key sets the new object's own
  // prototype at creation time — it is not copied as an own property, so
  // Object.assign(target, { __proto__: X }) never actually changes
  // `target`'s prototype (this previously left the thrown error as a plain
  // Error, so `instanceof PrismaClientKnownRequestError` in the real
  // service silently failed and the P2002/P2003 branches never ran).
  // Explicit Object.setPrototypeOf is what's actually needed here.
  const err = Object.assign(new Error('prisma error'), { code, clientVersion: '5.20.0', name: 'PrismaClientKnownRequestError' });
  Object.setPrototypeOf(err, Prisma.PrismaClientKnownRequestError.prototype);
  return err;
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
        // query() also fans each returned product out to its per-supplier
        // price rows (Phase 3 multi-supplier pricing) — empty by default,
        // no test in this file asserts on supplier pricing specifically.
        productSupplier: { findMany: jest.fn().mockResolvedValue([]) },
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
    // Nested under `where.AND`, not a bare top-level `where.OR` — a
    // supplier-match OR-group and a search-match OR-group are combined
    // with AND so "matches supplier AND matches search" isn't wrongly
    // flattened into "matches supplier OR matches search" (see query()'s
    // own header comment).
    expect(where.AND).toEqual([
      { OR: [{ article: { contains: 'widg', mode: 'insensitive' } }, { name: { contains: 'widg', mode: 'insensitive' } }] },
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
