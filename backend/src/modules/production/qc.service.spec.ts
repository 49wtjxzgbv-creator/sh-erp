import { NotFoundException } from '@nestjs/common';
import { QcService } from './qc.service';

describe('QcService', () => {
  let service: QcService;
  let prisma: any;
  let audit: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  beforeEach(() => {
    prisma = {
      tenant: {
        finishedGood: { findUnique: jest.fn(), update: jest.fn() },
        qcCheck: { create: jest.fn(), findMany: jest.fn() },
        qcCheckResult: { createMany: jest.fn() },
      },
    };
    audit = { record: jest.fn() };
    service = new QcService(prisma, audit);
  });

  it('throws NotFoundException for an unknown finished good', async () => {
    prisma.tenant.finishedGood.findUnique.mockResolvedValue(null);
    await expect(
      service.recordCheck(user, { finishedGoodId: 'fg1', result: 'ACCEPTED' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('flips the finished good to IN_STOCK on an ACCEPTED result', async () => {
    prisma.tenant.finishedGood.findUnique.mockResolvedValue({ id: 'fg1', status: 'IN_STOCK' });
    prisma.tenant.qcCheck.create.mockResolvedValue({ id: 'chk1' });
    prisma.tenant.finishedGood.update.mockResolvedValue({ id: 'fg1', status: 'IN_STOCK' });

    await service.recordCheck(user, { finishedGoodId: 'fg1', result: 'ACCEPTED' });

    expect(prisma.tenant.finishedGood.update).toHaveBeenCalledWith({
      where: { id: 'fg1' },
      data: { status: 'IN_STOCK' },
    });
  });

  it('flips the finished good to REWORK on a REWORK result and persists per-item results', async () => {
    prisma.tenant.finishedGood.findUnique.mockResolvedValue({ id: 'fg1', status: 'IN_STOCK' });
    prisma.tenant.qcCheck.create.mockResolvedValue({ id: 'chk1' });
    prisma.tenant.finishedGood.update.mockResolvedValue({ id: 'fg1', status: 'REWORK' });

    await service.recordCheck(user, {
      finishedGoodId: 'fg1',
      result: 'REWORK',
      results: [{ itemName: 'Paint finish', passed: false }],
    });

    expect(prisma.tenant.qcCheckResult.createMany).toHaveBeenCalledWith({
      data: [{ qcCheckId: 'chk1', itemName: 'Paint finish', passed: false }],
    });
    expect(prisma.tenant.finishedGood.update).toHaveBeenCalledWith({
      where: { id: 'fg1' },
      data: { status: 'REWORK' },
    });
  });
});
