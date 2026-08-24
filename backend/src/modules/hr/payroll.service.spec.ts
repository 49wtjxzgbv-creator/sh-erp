import { BadRequestException } from '@nestjs/common';
import { PayrollService } from './payroll.service';

describe('PayrollService', () => {
  let service: PayrollService;
  let prisma: any;
  let audit: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  beforeEach(() => {
    prisma = {
      tenant: {
        employee: { findUnique: jest.fn().mockResolvedValue({ id: 'e1' }), findMany: jest.fn().mockResolvedValue([]) },
        payrollEntry: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
        productionOrderWorker: { findMany: jest.fn().mockResolvedValue([]) },
        finishedGood: { findMany: jest.fn().mockResolvedValue([]) },
        qcCheck: { findMany: jest.fn().mockResolvedValue([]) },
      },
    };
    audit = { record: jest.fn() };
    const payrollPeriods = { assertDateNotClosed: jest.fn().mockResolvedValue(undefined) };
    service = new PayrollService(prisma, audit, payrollPeriods as any);
  });

  describe('recordManualEntry — sign convention (Phase 1 §3.5)', () => {
    it('rejects an unknown employee', async () => {
      prisma.tenant.employee.findUnique.mockResolvedValue(null);
      await expect(
        service.recordManualEntry(user, { employeeId: 'nope', type: 'BONUS', amount: 100 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('stores ADVANCE as a negative amount from a positive input magnitude', async () => {
      prisma.tenant.payrollEntry.create.mockResolvedValue({ id: 'p1' });
      await service.recordManualEntry(user, { employeeId: 'e1', type: 'ADVANCE', amount: 500 });
      expect(prisma.tenant.payrollEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'ADVANCE', amount: -500 }) }),
      );
    });

    it('stores PENALTY as a negative amount', async () => {
      prisma.tenant.payrollEntry.create.mockResolvedValue({ id: 'p1' });
      await service.recordManualEntry(user, { employeeId: 'e1', type: 'PENALTY', amount: 50 });
      expect(prisma.tenant.payrollEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'PENALTY', amount: -50 }) }),
      );
    });

    it('stores BONUS as a positive amount', async () => {
      prisma.tenant.payrollEntry.create.mockResolvedValue({ id: 'p1' });
      await service.recordManualEntry(user, { employeeId: 'e1', type: 'BONUS', amount: 200 });
      expect(prisma.tenant.payrollEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'BONUS', amount: 200 }) }),
      );
    });
  });

  describe('getPayrollSummaryReport — cross-referenced defect count (Phase 1 §6.5)', () => {
    it('sums entries by type into piecework/advances/bonuses/penalties and a signed netTotal', async () => {
      prisma.tenant.employee.findMany.mockResolvedValue([{ id: 'e1', fullName: 'Alice' }]);
      prisma.tenant.payrollEntry.findMany.mockResolvedValue([
        { employeeId: 'e1', type: 'PIECEWORK', amount: 300 },
        { employeeId: 'e1', type: 'ADVANCE', amount: -100 },
        { employeeId: 'e1', type: 'BONUS', amount: 50 },
        { employeeId: 'e1', type: 'PENALTY', amount: -20 },
      ]);

      const [line] = await service.getPayrollSummaryReport(user, {});

      expect(line).toEqual(
        expect.objectContaining({
          employeeId: 'e1',
          employeeName: 'Alice',
          piecework: 300,
          advances: -100,
          bonuses: 50,
          penalties: -20,
          netTotal: 230,
        }),
      );
    });

    it('counts a REWORK QC result against the employee assigned to that finished good\'s production order', async () => {
      prisma.tenant.employee.findMany.mockResolvedValue([{ id: 'e1', fullName: 'Alice' }]);
      prisma.tenant.payrollEntry.findMany.mockResolvedValue([]);
      prisma.tenant.productionOrderWorker.findMany.mockResolvedValue([{ employeeId: 'e1', productionOrderId: 'po1' }]);
      prisma.tenant.finishedGood.findMany.mockResolvedValue([
        { id: 'fg1', productionOrderId: 'po1' },
        { id: 'fg2', productionOrderId: 'po1' },
      ]);
      prisma.tenant.qcCheck.findMany.mockResolvedValue([{ finishedGoodId: 'fg1' }]); // one REWORK check

      const [line] = await service.getPayrollSummaryReport(user, {});

      expect(line.employeeId).toBe('e1');
      expect(line.defectCount).toBe(1);
    });

    it('never lets a QC-only employee (no payroll entries in period) disappear from the report', async () => {
      prisma.tenant.employee.findMany.mockResolvedValue([{ id: 'e1', fullName: 'Alice' }]);
      prisma.tenant.payrollEntry.findMany.mockResolvedValue([]); // no entries this period
      prisma.tenant.productionOrderWorker.findMany.mockResolvedValue([{ employeeId: 'e1', productionOrderId: 'po1' }]);
      prisma.tenant.finishedGood.findMany.mockResolvedValue([{ id: 'fg1', productionOrderId: 'po1' }]);
      prisma.tenant.qcCheck.findMany.mockResolvedValue([{ finishedGoodId: 'fg1' }]);

      const result = await service.getPayrollSummaryReport(user, {});
      expect(result).toHaveLength(1);
      expect(result[0].defectCount).toBe(1);
      expect(result[0].netTotal).toBe(0);
    });
  });
});
