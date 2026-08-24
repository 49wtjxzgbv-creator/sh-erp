import { ConflictException } from '@nestjs/common';
import { PayrollPeriodsService } from './payroll-periods.service';

describe('PayrollPeriodsService', () => {
  let service: PayrollPeriodsService;
  let prisma: any;
  let audit: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  const openPeriod = { id: 'p1', periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-01-31'), status: 'OPEN' };

  beforeEach(() => {
    prisma = {
      tenant: {
        payrollPeriod: { create: jest.fn(), findUnique: jest.fn().mockResolvedValue(openPeriod), findMany: jest.fn(), count: jest.fn(), update: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
      },
    };
    audit = { record: jest.fn() };
    service = new PayrollPeriodsService(prisma, audit);
  });

  describe('create', () => {
    it('rejects periodEnd before periodStart', async () => {
      await expect(
        service.create(user, { periodStart: new Date('2026-02-01'), periodEnd: new Date('2026-01-01') }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('close/reopen', () => {
    it('rejects closing an already-closed period', async () => {
      prisma.tenant.payrollPeriod.findUnique.mockResolvedValue({ ...openPeriod, status: 'CLOSED' });
      await expect(service.close(user, 'p1')).rejects.toThrow(ConflictException);
    });

    it('rejects reopening an already-open period', async () => {
      await expect(service.reopen(user, 'p1')).rejects.toThrow(ConflictException);
    });

    it('close() clears nothing, reopen() clears closedById/closedAt', async () => {
      prisma.tenant.payrollPeriod.findUnique.mockResolvedValue({ ...openPeriod, status: 'CLOSED' });
      await service.reopen(user, 'p1');
      expect(prisma.tenant.payrollPeriod.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { status: 'OPEN', closedById: null, closedAt: null },
      });
    });
  });

  describe('assertDateNotClosed (locked spec #13 — used by PayrollService and ProductionExecutionsService)', () => {
    it('passes silently when no CLOSED period covers the date', async () => {
      await expect(service.assertDateNotClosed(new Date('2026-03-01'))).resolves.toBeUndefined();
    });

    it('throws when a CLOSED period covers the date', async () => {
      prisma.tenant.payrollPeriod.findFirst.mockResolvedValue({ ...openPeriod, status: 'CLOSED' });
      await expect(service.assertDateNotClosed(new Date('2026-01-15'))).rejects.toThrow(ConflictException);
    });

    it('queries only CLOSED periods whose range contains the UTC start-of-day of the date', async () => {
      const date = new Date('2026-01-15T14:32:00Z');
      await service.assertDateNotClosed(date);
      expect(prisma.tenant.payrollPeriod.findFirst).toHaveBeenCalledWith({
        where: { status: 'CLOSED', periodStart: { lte: new Date('2026-01-15T00:00:00Z') }, periodEnd: { gte: new Date('2026-01-15T00:00:00Z') } },
      });
    });

    it('real incident (2026-08-25): blocks a timestamp later in the day than periodEnd\'s midnight — periodEnd covers the WHOLE last day, not just its first instant', async () => {
      // periodEnd stored as UTC midnight (date-only input) — a write at 23:39 that same day must still be blocked.
      prisma.tenant.payrollPeriod.findFirst.mockResolvedValue({
        ...openPeriod,
        status: 'CLOSED',
        periodStart: new Date('2026-01-10T00:00:00Z'),
        periodEnd: new Date('2026-01-31T00:00:00Z'),
      });
      await expect(service.assertDateNotClosed(new Date('2026-01-31T23:39:00Z'))).rejects.toThrow(ConflictException);
    });
  });
});
