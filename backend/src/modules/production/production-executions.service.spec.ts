import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ProductionExecutionsService } from './production-executions.service';

describe('ProductionExecutionsService', () => {
  let service: ProductionExecutionsService;
  let prisma: any;
  let audit: any;
  let payrollPeriods: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  const startedOrder = { id: 'po1', assemblyId: 'a1', unitsPlanned: 10, laborCostEur: 100, status: 'IN_PROGRESS' };
  const soloAllowedAssembly = { id: 'a1', soloAllowed: true };
  const openWorkTask = { id: 'wt1', fund: 50, status: 'OPEN' };

  const draftProductExecution = {
    id: 'ex1',
    companyId: 'c1',
    productionOrderId: 'po1',
    workTaskId: null,
    performedAt: new Date('2026-01-10'),
    qtyCompleted: 5,
    method: 'SOLO',
    teamId: null,
    allocationMode: 'PERCENT',
    totalAmount: 50,
    status: 'DRAFT',
    note: null,
    allocations: [{ id: 'al1', employeeId: 'e1', percent: 100, hours: null, amount: 50 }],
  };

  beforeEach(() => {
    prisma = {
      tenant: {
        productionExecution: {
          create: jest.fn(),
          findUnique: jest.fn(),
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
          update: jest.fn(),
          delete: jest.fn(),
        },
        productionExecutionAllocation: {
          update: jest.fn().mockResolvedValue({}),
          deleteMany: jest.fn(),
        },
        payrollEntry: { create: jest.fn().mockResolvedValue({ id: 'pe1' }) },
        productionOrder: { findUnique: jest.fn().mockResolvedValue(startedOrder) },
        assembly: { findUnique: jest.fn().mockResolvedValue(soloAllowedAssembly) },
        workTask: { findUnique: jest.fn().mockResolvedValue(openWorkTask) },
      },
    };
    audit = { record: jest.fn() };
    payrollPeriods = { assertDateNotClosed: jest.fn().mockResolvedValue(undefined) };
    service = new ProductionExecutionsService(prisma, audit, payrollPeriods);
  });

  // ============================================================
  // create — PRODUCT (locked spec #4: totalAmount is ALWAYS server-computed)
  // ============================================================
  describe('create — PRODUCT execution', () => {
    const validDto = {
      productionOrderId: 'po1',
      performedAt: new Date('2026-01-10'),
      qtyCompleted: 5,
      method: 'SOLO' as const,
      allocationMode: 'PERCENT' as const,
      allocations: [{ employeeId: 'e1', percent: 100 }],
    };

    it('rejects when neither productionOrderId nor workTaskId is given', async () => {
      await expect(service.create(user, { ...validDto, productionOrderId: undefined } as any)).rejects.toThrow(BadRequestException);
    });

    it('rejects when BOTH productionOrderId and workTaskId are given', async () => {
      await expect(service.create(user, { ...validDto, workTaskId: 'wt1' } as any)).rejects.toThrow(BadRequestException);
    });

    it('rejects a manually-supplied totalAmount — PRODUCT fund is never client input', async () => {
      await expect(service.create(user, { ...validDto, totalAmount: 999 } as any)).rejects.toThrow(BadRequestException);
      expect(prisma.tenant.productionExecution.create).not.toHaveBeenCalled();
    });

    it('rejects a missing qtyCompleted', async () => {
      await expect(service.create(user, { ...validDto, qtyCompleted: undefined } as any)).rejects.toThrow(BadRequestException);
    });

    it('rejects when the production order has not been started (status PLANNED)', async () => {
      prisma.tenant.productionOrder.findUnique.mockResolvedValue({ ...startedOrder, status: 'PLANNED' });
      await expect(service.create(user, validDto)).rejects.toThrow(ConflictException);
    });

    it('computes totalAmount = qtyCompleted / unitsPlanned x laborCostEur (5/10 x 100 = 50)', async () => {
      prisma.tenant.productionExecution.create.mockResolvedValue({ ...draftProductExecution });
      await service.create(user, validDto);
      expect(prisma.tenant.productionExecution.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ totalAmount: 50, qtyCompleted: 5 }) }),
      );
    });

    it('rejects when qtyCompleted would push CONFIRMED quantity past unitsPlanned (locked spec #5)', async () => {
      prisma.tenant.productionExecution.findMany.mockResolvedValue([{ qtyCompleted: 8, totalAmount: 80, status: 'CONFIRMED' }]);
      await expect(service.create(user, { ...validDto, qtyCompleted: 5 })).rejects.toThrow(ConflictException);
      expect(prisma.tenant.productionExecution.create).not.toHaveBeenCalled();
    });

    it('rejects when the resulting amount would push CONFIRMED total past laborCostEur, even if qty alone is within range', async () => {
      // unitsPlanned=10, laborCostEur=100: an order with a locally-reduced fund but same unitsPlanned would trip the amount guard first.
      prisma.tenant.productionOrder.findUnique.mockResolvedValue({ ...startedOrder, laborCostEur: 40 });
      prisma.tenant.productionExecution.findMany.mockResolvedValue([{ qtyCompleted: 2, totalAmount: 20, status: 'CONFIRMED' }]);
      // qty 5/10 x 40 = 20; confirmed 20 + 20 = 40 <= 40 OK — bump qty to exceed:
      await expect(service.create(user, { ...validDto, qtyCompleted: 6 })).rejects.toThrow(ConflictException);
    });

    it('rejects a duplicate employeeId across allocations', async () => {
      await expect(
        service.create(user, { ...validDto, allocations: [{ employeeId: 'e1', percent: 50 }, { employeeId: 'e1', percent: 50 }] }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a missing percent when allocationMode=PERCENT', async () => {
      await expect(service.create(user, { ...validDto, allocations: [{ employeeId: 'e1' }] })).rejects.toThrow(BadRequestException);
    });

    it('rejects a missing hours when allocationMode=HOURS', async () => {
      await expect(
        service.create(user, { ...validDto, allocationMode: 'HOURS', allocations: [{ employeeId: 'e1' }] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects allocations that are all zero-weighted', async () => {
      await expect(
        service.create(user, { ...validDto, allocations: [{ employeeId: 'e1', percent: 0 }, { employeeId: 'e2', percent: 0 }] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('splits totalAmount across allocations proportionally, with the remainder absorbed by the last row so the sum is exact (locked spec #6: PERCENT/HOURS only split, never determine, the fund)', async () => {
      prisma.tenant.productionExecution.create.mockResolvedValue({ ...draftProductExecution });
      // 5/10 x 100 = 50 total. 33/67 split -> 16.5 / 33.5, rounds to 16.50 and 33.50 (sums exactly to 50).
      await service.create(user, {
        ...validDto,
        allocations: [{ employeeId: 'e1', percent: 33 }, { employeeId: 'e2', percent: 67 }],
      });
      const call = prisma.tenant.productionExecution.create.mock.calls[0][0];
      const created = call.data.allocations.create as Array<{ employeeId: string; amount: number }>;
      const sum = created.reduce((s: number, a: any) => s + a.amount, 0);
      expect(sum).toBeCloseTo(50, 2);
    });

    it('checks the closed-payroll-period guard using performedAt', async () => {
      payrollPeriods.assertDateNotClosed.mockRejectedValue(new ConflictException('closed'));
      await expect(service.create(user, validDto)).rejects.toThrow(ConflictException);
      expect(payrollPeriods.assertDateNotClosed).toHaveBeenCalledWith(validDto.performedAt);
    });
  });

  // ============================================================
  // create — GENERAL (locked spec #7)
  // ============================================================
  describe('create — GENERAL (WorkTask) execution', () => {
    const validDto = {
      workTaskId: 'wt1',
      performedAt: new Date('2026-01-10'),
      totalAmount: 30,
      method: 'SOLO' as const,
      allocationMode: 'PERCENT' as const,
      allocations: [{ employeeId: 'e1', percent: 100 }],
    };

    it('rejects a missing totalAmount — GENERAL fund is always manual, but required', async () => {
      await expect(service.create(user, { ...validDto, totalAmount: undefined } as any)).rejects.toThrow(BadRequestException);
    });

    it('rejects recording against a CLOSED work task', async () => {
      prisma.tenant.workTask.findUnique.mockResolvedValue({ ...openWorkTask, status: 'CLOSED' });
      await expect(service.create(user, validDto)).rejects.toThrow(ConflictException);
    });

    it('rejects when totalAmount would push CONFIRMED total past WorkTask.fund (locked spec #7: reuses fund, no new field)', async () => {
      prisma.tenant.productionExecution.findMany.mockResolvedValue([{ totalAmount: 30, status: 'CONFIRMED' }]);
      await expect(service.create(user, { ...validDto, totalAmount: 30 })).rejects.toThrow(ConflictException);
    });

    it('accepts a valid GENERAL execution and never touches any ProductionOrder (locked spec #7: never reduces a batch fund)', async () => {
      prisma.tenant.productionExecution.create.mockResolvedValue({ ...draftProductExecution, productionOrderId: null, workTaskId: 'wt1' });
      await service.create(user, validDto);
      expect(prisma.tenant.productionOrder.findUnique).not.toHaveBeenCalled();
      expect(prisma.tenant.productionExecution.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ workTaskId: 'wt1', totalAmount: 30 }) }),
      );
    });
  });

  // ============================================================
  // confirm — the only place PayrollEntry PIECEWORK rows are generated
  // ============================================================
  describe('confirm', () => {
    beforeEach(() => {
      prisma.tenant.productionExecution.findUnique.mockResolvedValue({ ...draftProductExecution });
      prisma.tenant.productionExecution.update.mockResolvedValue({ ...draftProductExecution, status: 'CONFIRMED' });
    });

    it('rejects confirming a non-DRAFT execution', async () => {
      prisma.tenant.productionExecution.findUnique.mockResolvedValue({ ...draftProductExecution, status: 'CONFIRMED' });
      await expect(service.confirm(user, 'ex1')).rejects.toThrow(ConflictException);
    });

    it('creates exactly one PayrollEntry per allocation, linked via sourceAllocationId, and never touches ProductionOrderWorker (locked spec #9/#10)', async () => {
      await service.confirm(user, 'ex1');
      expect(prisma.tenant.payrollEntry.create).toHaveBeenCalledTimes(1);
      expect(prisma.tenant.payrollEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ employeeId: 'e1', type: 'PIECEWORK', amount: 50, sourceAllocationId: 'al1', productionOrderId: 'po1' }),
        }),
      );
    });

    it('flips status to CONFIRMED with confirmedById/confirmedAt', async () => {
      await service.confirm(user, 'ex1');
      expect(prisma.tenant.productionExecution.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ex1' },
          data: expect.objectContaining({ status: 'CONFIRMED', confirmedById: 'u1' }),
        }),
      );
    });

    it('enforces the SOLO guard: a single-allocation execution is rejected when the assembly forbids solo work (locked spec #12)', async () => {
      prisma.tenant.assembly.findUnique.mockResolvedValue({ id: 'a1', soloAllowed: false });
      await expect(service.confirm(user, 'ex1')).rejects.toThrow(ConflictException);
      expect(prisma.tenant.payrollEntry.create).not.toHaveBeenCalled();
    });

    it('allows a multi-allocation execution even when the assembly forbids solo work', async () => {
      prisma.tenant.assembly.findUnique.mockResolvedValue({ id: 'a1', soloAllowed: false });
      prisma.tenant.productionExecution.findUnique.mockResolvedValue({
        ...draftProductExecution,
        allocations: [
          { id: 'al1', employeeId: 'e1', percent: 50, hours: null, amount: 25 },
          { id: 'al2', employeeId: 'e2', percent: 50, hours: null, amount: 25 },
        ],
      });
      await service.confirm(user, 'ex1');
      expect(prisma.tenant.payrollEntry.create).toHaveBeenCalledTimes(2);
    });

    it('checks the closed-payroll-period guard using the execution\'s own performedAt', async () => {
      payrollPeriods.assertDateNotClosed.mockRejectedValue(new ConflictException('closed'));
      await expect(service.confirm(user, 'ex1')).rejects.toThrow(ConflictException);
    });
  });

  // ============================================================
  // void — compensating entries, never edits the original (locked spec #8)
  // ============================================================
  describe('void_', () => {
    const confirmedExecution = { ...draftProductExecution, status: 'CONFIRMED', confirmedById: 'u1', confirmedAt: new Date() };

    beforeEach(() => {
      prisma.tenant.productionExecution.findUnique.mockResolvedValue({ ...confirmedExecution });
      prisma.tenant.productionExecution.update.mockResolvedValue({ ...confirmedExecution, status: 'VOIDED' });
    });

    it('rejects voiding a non-CONFIRMED execution', async () => {
      prisma.tenant.productionExecution.findUnique.mockResolvedValue({ ...draftProductExecution, status: 'DRAFT' });
      await expect(service.void_(user, 'ex1', {})).rejects.toThrow(ConflictException);
    });

    it('creates one negative compensating PayrollEntry per allocation, WITHOUT reusing sourceAllocationId (it is @unique — already claimed by the original entry)', async () => {
      await service.void_(user, 'ex1', { note: 'oops' });
      expect(prisma.tenant.payrollEntry.create).toHaveBeenCalledTimes(1);
      const data = prisma.tenant.payrollEntry.create.mock.calls[0][0].data;
      expect(data.amount).toBe(-50);
      expect(data.sourceAllocationId).toBeUndefined();
      expect(data.comment).toContain('ex1');
    });

    it('never mutates the original execution/allocation rows — only sets status VOIDED on the execution itself', async () => {
      await service.void_(user, 'ex1', {});
      expect(prisma.tenant.productionExecutionAllocation.update).not.toHaveBeenCalled();
      expect(prisma.tenant.productionExecution.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'ex1' }, data: expect.objectContaining({ status: 'VOIDED' }) }),
      );
    });
  });

  // ============================================================
  // correct — void + create, linked via supersedesId
  // ============================================================
  describe('correct', () => {
    const confirmedExecution = { ...draftProductExecution, status: 'CONFIRMED' };
    const correctDto = {
      performedAt: new Date('2026-01-11'),
      qtyCompleted: 4,
      method: 'SOLO' as const,
      allocationMode: 'PERCENT' as const,
      allocations: [{ employeeId: 'e1', percent: 100 }],
    };

    it('rejects correcting a non-CONFIRMED execution', async () => {
      prisma.tenant.productionExecution.findUnique.mockResolvedValue({ ...draftProductExecution, status: 'DRAFT' });
      await expect(service.correct(user, 'ex1', correctDto)).rejects.toThrow(ConflictException);
    });

    it('voids the original, creates a new DRAFT against the SAME parent, and links it via supersedesId', async () => {
      prisma.tenant.productionExecution.findUnique.mockResolvedValue({ ...confirmedExecution });
      prisma.tenant.productionExecution.update
        .mockResolvedValueOnce({ ...confirmedExecution, status: 'VOIDED' }) // void_()'s own update
        .mockResolvedValueOnce({ id: 'ex2', supersedesId: 'ex1' }); // the supersedesId link update
      prisma.tenant.productionExecution.create.mockResolvedValue({ ...draftProductExecution, id: 'ex2' });

      await service.correct(user, 'ex1', correctDto);

      expect(prisma.tenant.productionExecution.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ productionOrderId: 'po1' }) }),
      );
      expect(prisma.tenant.productionExecution.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: { id: 'ex2' }, data: { supersedesId: 'ex1' } }),
      );
    });
  });

  // ============================================================
  // remove / patch — DRAFT-only
  // ============================================================
  describe('remove', () => {
    it('rejects deleting a CONFIRMED execution — must be voided instead', async () => {
      prisma.tenant.productionExecution.findUnique.mockResolvedValue({ ...draftProductExecution, status: 'CONFIRMED' });
      await expect(service.remove(user, 'ex1')).rejects.toThrow(ConflictException);
      expect(prisma.tenant.productionExecution.delete).not.toHaveBeenCalled();
    });

    it('deletes a DRAFT outright', async () => {
      prisma.tenant.productionExecution.findUnique.mockResolvedValue({ ...draftProductExecution });
      await service.remove(user, 'ex1');
      expect(prisma.tenant.productionExecution.delete).toHaveBeenCalledWith({ where: { id: 'ex1' } });
    });
  });

  describe('patch', () => {
    it('rejects editing a CONFIRMED execution', async () => {
      prisma.tenant.productionExecution.findUnique.mockResolvedValue({ ...draftProductExecution, status: 'CONFIRMED' });
      await expect(service.patch(user, 'ex1', { qtyCompleted: 6 })).rejects.toThrow(ConflictException);
    });

    it('recomputes totalAmount when qtyCompleted changes on a DRAFT', async () => {
      prisma.tenant.productionExecution.findUnique.mockResolvedValue({ ...draftProductExecution });
      prisma.tenant.productionExecution.update.mockResolvedValue({ ...draftProductExecution, qtyCompleted: 8, totalAmount: 80 });
      await service.patch(user, 'ex1', { qtyCompleted: 8 });
      expect(prisma.tenant.productionExecution.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ qtyCompleted: 8, totalAmount: 80 }) }),
      );
    });
  });
});
