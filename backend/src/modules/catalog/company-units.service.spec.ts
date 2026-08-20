import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CompanyUnitsService, DEFAULT_COMPANY_UNITS } from './company-units.service';

function prismaKnownError(code: string) {
  // `{ __proto__: X }` as an OBJECT-LITERAL key sets the new object's own
  // prototype at creation time — it is not copied as an own property, so
  // Object.assign(target, { __proto__: X }) never actually changes
  // `target`'s prototype (this previously left the thrown error as a plain
  // Error, so `instanceof PrismaClientKnownRequestError` in the real
  // service silently failed and the P2002 branch never ran). Explicit
  // Object.setPrototypeOf is what's actually needed to fake this shape.
  const err = Object.assign(new Error('prisma error'), { code });
  Object.setPrototypeOf(err, Prisma.PrismaClientKnownRequestError.prototype);
  return err;
}

describe('CompanyUnitsService', () => {
  let service: CompanyUnitsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      tenant: {
        companyUnit: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
        product: { count: jest.fn() },
      },
    };
    service = new CompanyUnitsService(prisma);
  });

  it('seedDefaults() creates the 6 legacy default units (mirrors seedUnitsIfEmpty_)', async () => {
    const tx = { companyUnit: { createMany: jest.fn() } };
    await service.seedDefaults(tx as any, 'c1');
    expect(tx.companyUnit.createMany).toHaveBeenCalledWith({
      data: DEFAULT_COMPANY_UNITS.map((name) => ({ companyId: 'c1', name })),
    });
    expect(DEFAULT_COMPANY_UNITS).toEqual(['шт', 'уп', 'кг', 'м', 'рулон', 'комплект']);
  });

  it('create() rejects a duplicate unit name (P2002) with ConflictException', async () => {
    prisma.tenant.companyUnit.create.mockRejectedValue(prismaKnownError('P2002'));
    await expect(service.create({ name: 'шт' })).rejects.toThrow(ConflictException);
  });

  it('remove() rejects deletion when products still reference the unit', async () => {
    prisma.tenant.product.count.mockResolvedValue(3);
    await expect(service.remove('unit1')).rejects.toThrow(ConflictException);
    expect(prisma.tenant.companyUnit.delete).not.toHaveBeenCalled();
  });

  it('remove() throws NotFoundException for a nonexistent unit', async () => {
    prisma.tenant.product.count.mockResolvedValue(0);
    prisma.tenant.companyUnit.findUnique.mockResolvedValue(null);
    await expect(service.remove('missing')).rejects.toThrow(NotFoundException);
  });

  it('remove() succeeds when unused', async () => {
    prisma.tenant.product.count.mockResolvedValue(0);
    prisma.tenant.companyUnit.findUnique.mockResolvedValue({ id: 'unit1' });
    const result = await service.remove('unit1');
    expect(prisma.tenant.companyUnit.delete).toHaveBeenCalledWith({ where: { id: 'unit1' } });
    expect(result).toEqual({ ok: true });
  });
});
