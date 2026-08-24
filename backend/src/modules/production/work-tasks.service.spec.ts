import { ConflictException, NotFoundException } from '@nestjs/common';
import { WorkTasksService } from './work-tasks.service';

describe('WorkTasksService', () => {
  let service: WorkTasksService;
  let prisma: any;
  let audit: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  const openTask = { id: 'wt1', title: 'Cleanup', fund: 100, status: 'OPEN', createdById: 'u1', items: [] };

  beforeEach(() => {
    prisma = {
      tenant: {
        workTask: { create: jest.fn(), findUnique: jest.fn().mockResolvedValue(openTask), findMany: jest.fn(), count: jest.fn(), update: jest.fn(), delete: jest.fn() },
        workTaskItem: { deleteMany: jest.fn(), createMany: jest.fn() },
        productionExecution: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      },
    };
    audit = { record: jest.fn() };
    service = new WorkTasksService(prisma, audit);
  });

  describe('update', () => {
    it('rejects lowering fund below what CONFIRMED executions have already drawn', async () => {
      prisma.tenant.productionExecution.findMany.mockResolvedValue([{ totalAmount: 60, status: 'CONFIRMED' }]);
      await expect(service.update(user, 'wt1', { fund: 50 })).rejects.toThrow(ConflictException);
      expect(prisma.tenant.workTask.update).not.toHaveBeenCalled();
    });

    it('allows lowering fund to exactly the CONFIRMED total', async () => {
      prisma.tenant.productionExecution.findMany.mockResolvedValue([{ totalAmount: 60, status: 'CONFIRMED' }]);
      prisma.tenant.workTask.update.mockResolvedValue({ ...openTask, fund: 60 });
      await service.update(user, 'wt1', { fund: 60 });
      expect(prisma.tenant.workTask.update).toHaveBeenCalled();
    });
  });

  describe('close/reopen', () => {
    it('rejects closing an already-closed task', async () => {
      prisma.tenant.workTask.findUnique.mockResolvedValue({ ...openTask, status: 'CLOSED' });
      await expect(service.close(user, 'wt1')).rejects.toThrow(ConflictException);
    });

    it('rejects reopening an already-open task', async () => {
      await expect(service.reopen(user, 'wt1')).rejects.toThrow(ConflictException);
    });
  });

  describe('remove', () => {
    it('rejects deleting a task with recorded executions — the DB CHECK constraint would otherwise reject it raw', async () => {
      prisma.tenant.productionExecution.count.mockResolvedValue(2);
      await expect(service.remove(user, 'wt1')).rejects.toThrow(ConflictException);
      expect(prisma.tenant.workTask.delete).not.toHaveBeenCalled();
    });

    it('deletes a task with no executions', async () => {
      await service.remove(user, 'wt1');
      expect(prisma.tenant.workTask.delete).toHaveBeenCalledWith({ where: { id: 'wt1' } });
    });
  });

  describe('findOne', () => {
    it('throws a coded not-found for a missing task', async () => {
      prisma.tenant.workTask.findUnique.mockResolvedValue(null);
      await expect(service.findOne(user, 'nope')).rejects.toThrow(NotFoundException);
    });
  });
});
