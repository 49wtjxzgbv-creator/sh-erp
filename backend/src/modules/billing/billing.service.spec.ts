import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BillingService } from './billing.service';

describe('BillingService', () => {
  let service: BillingService;
  let prisma: any;
  let audit: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  beforeEach(() => {
    prisma = {
      plan: { findUnique: jest.fn() },
      tenant: {
        companySubscription: { findUnique: jest.fn(), update: jest.fn() },
      },
    };
    audit = { record: jest.fn() };
    service = new BillingService(prisma, audit);
  });

  describe('seedDefaultSubscription — called from CompanyService.createCompany at signup', () => {
    it('creates a subscription on the starter plan', async () => {
      const tx = {
        plan: { findUnique: jest.fn().mockResolvedValue({ id: 'plan-starter', key: 'starter' }) },
        companySubscription: { create: jest.fn() },
      };

      await service.seedDefaultSubscription(tx as any, 'c1');

      expect(tx.plan.findUnique).toHaveBeenCalledWith({ where: { key: 'starter' } });
      expect(tx.companySubscription.create).toHaveBeenCalledWith({ data: { companyId: 'c1', planId: 'plan-starter' } });
    });

    it('throws a clear error if the starter plan has not been seeded yet', async () => {
      const tx = { plan: { findUnique: jest.fn().mockResolvedValue(null) }, companySubscription: { create: jest.fn() } };
      await expect(service.seedDefaultSubscription(tx as any, 'c1')).rejects.toThrow(BadRequestException);
      expect(tx.companySubscription.create).not.toHaveBeenCalled();
    });
  });

  describe('getSubscription', () => {
    it('joins the subscription with its plan', async () => {
      prisma.tenant.companySubscription.findUnique.mockResolvedValue({ companyId: 'c1', planId: 'plan-growth', status: 'ACTIVE' });
      prisma.plan.findUnique.mockResolvedValue({ id: 'plan-growth', key: 'growth', name: 'Growth' });

      const result = await service.getSubscription(user);
      expect(result).toEqual(expect.objectContaining({ status: 'ACTIVE', plan: expect.objectContaining({ key: 'growth' }) }));
    });

    it('throws NotFoundException when the company somehow has no subscription row', async () => {
      prisma.tenant.companySubscription.findUnique.mockResolvedValue(null);
      await expect(service.getSubscription(user)).rejects.toThrow(NotFoundException);
    });
  });

  describe('updatePlan — stub, records the switch without collecting payment', () => {
    it('rejects an unknown plan key', async () => {
      prisma.plan.findUnique.mockResolvedValue(null);
      await expect(service.updatePlan(user, { planKey: 'enterprise' } as any)).rejects.toThrow(NotFoundException);
    });

    it('updates the subscription row and audits the change', async () => {
      prisma.plan.findUnique.mockResolvedValue({ id: 'plan-enterprise', key: 'enterprise' });
      prisma.tenant.companySubscription.findUnique.mockResolvedValue({ companyId: 'c1', planId: 'plan-starter' });
      prisma.tenant.companySubscription.update.mockResolvedValue({ companyId: 'c1', planId: 'plan-enterprise' });

      const result = await service.updatePlan(user, { planKey: 'enterprise' } as any);

      expect(prisma.tenant.companySubscription.update).toHaveBeenCalledWith({
        where: { companyId: 'c1' },
        data: { planId: 'plan-enterprise' },
      });
      expect(result.plan.key).toBe('enterprise');
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'company_subscription.plan_changed' }));
    });
  });
});
