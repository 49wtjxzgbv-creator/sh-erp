import { NotFoundException } from '@nestjs/common';
import { ProductionStagesService } from './production-stages.service';

describe('ProductionStagesService', () => {
  let service: ProductionStagesService;
  let prisma: any;
  let auditService: any;
  const user = { userId: 'u1', companyId: 'c1' } as any;

  beforeEach(() => {
    prisma = {
      tenant: {
        productionStage: { findUnique: jest.fn(), findMany: jest.fn(), delete: jest.fn(), update: jest.fn() },
        productionOrderStagePlan: { deleteMany: jest.fn() },
      },
    };
    auditService = { record: jest.fn() };
    service = new ProductionStagesService(prisma, auditService);
  });

  it('remove() throws NotFoundException for a nonexistent stage', async () => {
    prisma.tenant.productionStage.findUnique.mockResolvedValue(null);
    await expect(service.remove(user, 'missing')).rejects.toThrow(NotFoundException);
    expect(prisma.tenant.productionOrderStagePlan.deleteMany).not.toHaveBeenCalled();
  });

  // Regression test: ProductionOrderStagePlan (План-графік/Planner schedule)
  // holds a real FK to ProductionStage with the Prisma default (Restrict),
  // so deleting a stage assigned to any order's schedule used to fail with
  // a raw, untranslated Postgres FK-violation 500. The fix drops the
  // dependent (non-financial, scheduling-only) plan rows first.
  it('remove() clears dependent stage-plan rows before deleting the stage', async () => {
    prisma.tenant.productionStage.findUnique.mockResolvedValue({ id: 'stage1', sortOrder: 1 });
    prisma.tenant.productionStage.findMany.mockResolvedValue([]);

    const result = await service.remove(user, 'stage1');

    expect(prisma.tenant.productionOrderStagePlan.deleteMany).toHaveBeenCalledWith({ where: { productionStageId: 'stage1' } });
    const stagePlanCall = prisma.tenant.productionOrderStagePlan.deleteMany.mock.invocationCallOrder[0];
    const stageDeleteCall = prisma.tenant.productionStage.delete.mock.invocationCallOrder[0];
    expect(stagePlanCall).toBeLessThan(stageDeleteCall);
    expect(prisma.tenant.productionStage.delete).toHaveBeenCalledWith({ where: { id: 'stage1' } });
    expect(result).toEqual({ ok: true });
  });

  it('remove() renumbers remaining stages to stay contiguous', async () => {
    prisma.tenant.productionStage.findUnique.mockResolvedValue({ id: 'stage1', sortOrder: 0 });
    prisma.tenant.productionStage.findMany.mockResolvedValue([
      { id: 'stage2', sortOrder: 1 },
      { id: 'stage3', sortOrder: 2 },
    ]);

    await service.remove(user, 'stage1');

    expect(prisma.tenant.productionStage.update).toHaveBeenCalledWith({ where: { id: 'stage2' }, data: { sortOrder: 0 } });
    expect(prisma.tenant.productionStage.update).toHaveBeenCalledWith({ where: { id: 'stage3' }, data: { sortOrder: 1 } });
  });
});
