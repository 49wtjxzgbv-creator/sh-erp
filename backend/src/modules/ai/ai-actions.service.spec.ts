import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AiActionsService } from './ai-actions.service';

describe('AiActionsService', () => {
  let service: AiActionsService;
  let prisma: any;
  let audit: any;
  let toolsRegistry: any;
  let settingsService: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  beforeEach(() => {
    prisma = {
      tenant: {
        pendingAiAction: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
        aiUsageLog: { create: jest.fn(), aggregate: jest.fn() },
        role: { findUnique: jest.fn().mockResolvedValue({ permissions: [] }) },
      },
    };
    audit = { record: jest.fn() };
    toolsRegistry = { getTool: jest.fn() };
    settingsService = { getMonthlyQuota: jest.fn() };
    service = new AiActionsService(prisma, audit, toolsRegistry, settingsService);
  });

  describe('proposeAction — durable PendingAiAction row (Phase 2 §8)', () => {
    it('creates a PENDING row with a future expiresAt and audits the proposal', async () => {
      prisma.tenant.pendingAiAction.create.mockResolvedValue({ id: 'pa1' });
      const result = await service.proposeAction(user, 'adjustProductStock', { article: 'X' }, 'Change stock');

      expect(prisma.tenant.pendingAiAction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'u1', actionKey: 'adjustProductStock', description: 'Change stock' }),
        }),
      );
      const [[createArgs]] = prisma.tenant.pendingAiAction.create.mock.calls;
      expect(createArgs.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(result).toEqual({ id: 'pa1' });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'ai_action.proposed' }));
    });
  });

  describe('confirmAction — the ONLY path that runs a critical tool\'s real execute()', () => {
    it('rejects an unknown pendingActionId', async () => {
      prisma.tenant.pendingAiAction.findUnique.mockResolvedValue(null);
      await expect(service.confirmAction(user, 'nope')).rejects.toThrow(NotFoundException);
    });

    it('rejects an already-resolved action', async () => {
      prisma.tenant.pendingAiAction.findUnique.mockResolvedValue({ id: 'pa1', status: 'CONFIRMED', expiresAt: new Date(Date.now() + 1000) });
      await expect(service.confirmAction(user, 'pa1')).rejects.toThrow(BadRequestException);
    });

    it('marks an expired-but-still-PENDING action EXPIRED and rejects', async () => {
      prisma.tenant.pendingAiAction.findUnique.mockResolvedValue({ id: 'pa1', status: 'PENDING', expiresAt: new Date(Date.now() - 1000) });
      prisma.tenant.pendingAiAction.update.mockResolvedValue({});

      await expect(service.confirmAction(user, 'pa1')).rejects.toThrow(BadRequestException);
      expect(prisma.tenant.pendingAiAction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'EXPIRED' }) }),
      );
    });

    it('runs the real tool.execute() directly (bypassing the registry\'s critical short-circuit) and marks CONFIRMED', async () => {
      const pending = { id: 'pa1', status: 'PENDING', expiresAt: new Date(Date.now() + 60_000), actionKey: 'adjustProductStock', args: { article: 'X', newQty: 5 } };
      prisma.tenant.pendingAiAction.findUnique.mockResolvedValue(pending);
      prisma.tenant.pendingAiAction.update.mockResolvedValue({ ...pending, status: 'CONFIRMED' });
      const execute = jest.fn().mockResolvedValue({ message: 'adjusted' });
      toolsRegistry.getTool.mockReturnValue({ key: 'adjustProductStock', critical: true, execute });

      const result = await service.confirmAction(user, 'pa1');

      expect(execute).toHaveBeenCalledWith(pending.args, expect.objectContaining({ user }));
      expect(result).toEqual({ message: 'adjusted' });
      expect(prisma.tenant.pendingAiAction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'CONFIRMED' }) }),
      );
    });

    it('rejects if the action key no longer maps to a known tool', async () => {
      prisma.tenant.pendingAiAction.findUnique.mockResolvedValue({ id: 'pa1', status: 'PENDING', expiresAt: new Date(Date.now() + 60_000), actionKey: 'gone', args: {} });
      toolsRegistry.getTool.mockReturnValue(undefined);
      await expect(service.confirmAction(user, 'pa1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('cancelAction', () => {
    it('marks a PENDING action CANCELLED', async () => {
      prisma.tenant.pendingAiAction.findUnique.mockResolvedValue({ id: 'pa1', status: 'PENDING' });
      prisma.tenant.pendingAiAction.update.mockResolvedValue({ id: 'pa1', status: 'CANCELLED' });

      const result = await service.cancelAction(user, 'pa1');
      expect(result.status).toBe('CANCELLED');
    });

    it('rejects cancelling an already-resolved action', async () => {
      prisma.tenant.pendingAiAction.findUnique.mockResolvedValue({ id: 'pa1', status: 'CONFIRMED' });
      await expect(service.cancelAction(user, 'pa1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('checkQuota — monthly-aggregate quota check (disclosed Redis-token-bucket simplification)', () => {
    it('allows the call through when no quota is configured', async () => {
      settingsService.getMonthlyQuota.mockResolvedValue(null);
      await expect(service.checkQuota(user)).resolves.toBeUndefined();
      expect(prisma.tenant.aiUsageLog.aggregate).not.toHaveBeenCalled();
    });

    it('allows the call through when usage is under quota', async () => {
      settingsService.getMonthlyQuota.mockResolvedValue(10_000);
      prisma.tenant.aiUsageLog.aggregate.mockResolvedValue({ _sum: { tokensUsed: 500 } });
      await expect(service.checkQuota(user)).resolves.toBeUndefined();
    });

    it('rejects once this month\'s usage has reached the configured quota', async () => {
      settingsService.getMonthlyQuota.mockResolvedValue(1000);
      prisma.tenant.aiUsageLog.aggregate.mockResolvedValue({ _sum: { tokensUsed: 1000 } });
      await expect(service.checkQuota(user)).rejects.toThrow(ForbiddenException);
    });
  });
});
