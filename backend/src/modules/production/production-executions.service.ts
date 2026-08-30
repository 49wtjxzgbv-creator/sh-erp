import { Injectable } from '@nestjs/common';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { CodedBadRequestException, CodedConflictException, CodedNotFoundException } from '../../common/api-exceptions';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PayrollPeriodsService } from '../hr/payroll-periods.service';
import {
  CorrectProductionExecutionDto,
  CreateProductionExecutionDto,
  PatchProductionExecutionDto,
  ProductionExecutionAllocationDto,
  QueryProductionExecutionsDto,
  VoidProductionExecutionDto,
} from './dto/production-execution.dto';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const FUND_EPSILON = 0.005;

interface AllocationRow {
  employeeId: string;
  percent?: number;
  hours?: number;
  amount: number;
}

/**
 * ONE recorded piece of labor — against a specific ProductionOrder batch
 * (PRODUCT) or a standalone WorkTask (GENERAL). Confirming an execution is
 * the ONLY place PayrollEntry PIECEWORK rows are generated (the old
 * one-shot generation in ProductionOrdersService.start() is removed —
 * see that file's own comment at the removal site). A CONFIRMED execution
 * is never edited: `void()` + `correct()` are the only ways to change
 * history after confirm, both leaving the original row and its PayrollEntry
 * fully intact (immutable-ledger convention, same as PayrollEntry itself).
 *
 * Every method here runs as plain sequential `this.prisma.tenant.*` calls,
 * deliberately NOT wrapped in a manual `$transaction` — `TenantScopeInterceptor`
 * already opens exactly one RLS-activated transaction per request
 * (prisma.service.ts's `runInTenantTransaction`), so everything a single
 * request handler does through `this.prisma.tenant` is already atomic.
 * This matches the convention already used by every other multi-step
 * mutation in this codebase (e.g. ProductionOrdersService.start()).
 */
@Injectable()
export class ProductionExecutionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly payrollPeriodsService: PayrollPeriodsService,
  ) {}

  // ============================================================
  // Create / query / patch
  // ============================================================

  async create(user: RequestUser, dto: CreateProductionExecutionDto) {
    this.assertExactlyOneParent(dto.productionOrderId, dto.workTaskId);
    this.assertAllocationsValid(dto.allocationMode, dto.allocations);
    await this.payrollPeriodsService.assertDateNotClosed(dto.performedAt);

    if (dto.productionOrderId) {
      if (dto.totalAmount !== undefined) {
        throw new CodedBadRequestException(
          'PRODUCTION_EXECUTION_TOTAL_AMOUNT_NOT_ALLOWED',
          'totalAmount is system-computed for PRODUCT executions (qtyCompleted / unitsPlanned x laborCostEur) and must not be provided.',
        );
      }
      if (dto.qtyCompleted === undefined) {
        throw new CodedBadRequestException('PRODUCTION_EXECUTION_QTY_REQUIRED', 'qtyCompleted is required for a PRODUCT execution.');
      }
      const order = await this.getStartedProductionOrder(dto.productionOrderId);
      const totalAmount = await this.computeAndValidateProductAmount(order, dto.qtyCompleted);
      const rows = this.buildAllocationRows(dto.allocationMode, totalAmount, dto.allocations);

      const execution = await this.prisma.tenant.productionExecution.create({
        data: {
          productionOrderId: order.id,
          performedAt: dto.performedAt,
          qtyCompleted: dto.qtyCompleted,
          method: dto.method,
          teamId: dto.teamId,
          allocationMode: dto.allocationMode,
          totalAmount,
          status: 'DRAFT',
          recordedById: user.userId,
          note: dto.note,
          allocations: { create: rows.map((r) => this.allocationCreateData(r)) },
        } as any,
        include: { allocations: true },
      });

      await this.auditService.record({
        companyId: user.companyId,
        actorUserId: user.userId,
        action: 'production_execution.created',
        entityType: 'ProductionExecution',
        entityId: execution.id,
        after: execution,
      });
      return execution;
    }

    const workTask = await this.getOpenWorkTask(dto.workTaskId!);
    if (dto.totalAmount === undefined) {
      throw new CodedBadRequestException('PRODUCTION_EXECUTION_TOTAL_AMOUNT_REQUIRED', 'totalAmount is required for a GENERAL execution.');
    }
    await this.assertGeneralFundAvailable(workTask, dto.totalAmount);
    const rows = this.buildAllocationRows(dto.allocationMode, dto.totalAmount, dto.allocations);

    const execution = await this.prisma.tenant.productionExecution.create({
      data: {
        workTaskId: workTask.id,
        performedAt: dto.performedAt,
        qtyCompleted: dto.qtyCompleted,
        method: dto.method,
        teamId: dto.teamId,
        allocationMode: dto.allocationMode,
        totalAmount: dto.totalAmount,
        status: 'DRAFT',
        recordedById: user.userId,
        note: dto.note,
        allocations: { create: rows.map((r) => this.allocationCreateData(r)) },
      } as any,
      include: { allocations: true },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'production_execution.created',
      entityType: 'ProductionExecution',
      entityId: execution.id,
      after: execution,
    });
    return execution;
  }

  async query(user: RequestUser, query: QueryProductionExecutionsDto) {
    const where: Record<string, any> = {};
    if (query.productionOrderId) where.productionOrderId = query.productionOrderId;
    if (query.workTaskId) where.workTaskId = query.workTaskId;
    if (query.status) where.status = query.status;

    const take = query.limit ?? 50;
    const skip = query.offset ?? 0;
    const [items, total] = await Promise.all([
      this.prisma.tenant.productionExecution.findMany({
        where,
        include: { allocations: true },
        orderBy: { performedAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.tenant.productionExecution.count({ where }),
    ]);
    return { items, total, limit: take, offset: skip };
  }

  async findOne(user: RequestUser, id: string) {
    const execution = await this.prisma.tenant.productionExecution.findUnique({ where: { id }, include: { allocations: true } });
    if (!execution) throw new CodedNotFoundException('PRODUCTION_EXECUTION_NOT_FOUND', 'Production execution not found.');
    return execution;
  }

  /** DRAFT-only. The parent (productionOrderId/workTaskId) never changes — only the fields below. */
  async patch(user: RequestUser, id: string, dto: PatchProductionExecutionDto) {
    const execution = await this.findOne(user, id);
    if (execution.status !== 'DRAFT') {
      throw new CodedConflictException('PRODUCTION_EXECUTION_NOT_DRAFT', 'Only a DRAFT execution can be edited.');
    }

    const method = dto.method ?? execution.method;
    const teamId = dto.teamId !== undefined ? dto.teamId : execution.teamId ?? undefined;
    const allocationMode = dto.allocationMode ?? execution.allocationMode;
    const performedAt = dto.performedAt ?? execution.performedAt;
    const note = dto.note !== undefined ? dto.note : execution.note ?? undefined;
    const allocationsInput: ProductionExecutionAllocationDto[] =
      dto.allocations ??
      execution.allocations.map((a) => ({
        employeeId: a.employeeId,
        percent: a.percent !== null ? Number(a.percent) : undefined,
        hours: a.hours !== null ? Number(a.hours) : undefined,
      }));
    this.assertAllocationsValid(allocationMode, allocationsInput);
    await this.payrollPeriodsService.assertDateNotClosed(performedAt);

    let totalAmount: number;
    let qtyCompleted: number | undefined = dto.qtyCompleted ?? (execution.qtyCompleted !== null ? Number(execution.qtyCompleted) : undefined);

    if (execution.productionOrderId) {
      if (dto.totalAmount !== undefined) {
        throw new CodedBadRequestException(
          'PRODUCTION_EXECUTION_TOTAL_AMOUNT_NOT_ALLOWED',
          'totalAmount is system-computed for PRODUCT executions and must not be provided.',
        );
      }
      if (qtyCompleted === undefined) {
        throw new CodedBadRequestException('PRODUCTION_EXECUTION_QTY_REQUIRED', 'qtyCompleted is required for a PRODUCT execution.');
      }
      const order = await this.getStartedProductionOrder(execution.productionOrderId);
      totalAmount = await this.computeAndValidateProductAmount(order, qtyCompleted);
    } else {
      const workTask = await this.getOpenWorkTask(execution.workTaskId!);
      totalAmount = dto.totalAmount ?? Number(execution.totalAmount);
      await this.assertGeneralFundAvailable(workTask, totalAmount);
    }

    const rows = this.buildAllocationRows(allocationMode, totalAmount, allocationsInput);

    await this.prisma.tenant.productionExecutionAllocation.deleteMany({ where: { executionId: id } });
    const updated = await this.prisma.tenant.productionExecution.update({
      where: { id },
      data: {
        performedAt,
        qtyCompleted,
        method,
        teamId,
        allocationMode,
        totalAmount,
        note,
        allocations: { create: rows.map((r) => this.allocationCreateData(r)) },
      } as any,
      include: { allocations: true },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'production_execution.updated',
      entityType: 'ProductionExecution',
      entityId: id,
      before: execution,
      after: updated,
    });
    return updated;
  }

  /** Hard delete — only ever valid for a DRAFT, which has no PayrollEntry yet. A CONFIRMED execution can only be void()'d, never removed. */
  async remove(user: RequestUser, id: string) {
    const execution = await this.findOne(user, id);
    if (execution.status !== 'DRAFT') {
      throw new CodedConflictException('PRODUCTION_EXECUTION_NOT_DRAFT', 'Only a DRAFT execution can be deleted — a CONFIRMED one must be voided instead.');
    }
    await this.prisma.tenant.productionExecution.delete({ where: { id } });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'production_execution.deleted',
      entityType: 'ProductionExecution',
      entityId: id,
      before: execution,
    });
  }

  // ============================================================
  // Confirm / void / correct
  // ============================================================

  /** The only place PIECEWORK PayrollEntry rows are ever created — exactly one per allocation, linked via sourceAllocationId. */
  async confirm(user: RequestUser, id: string) {
    const execution = await this.findOne(user, id);
    if (execution.status !== 'DRAFT') {
      throw new CodedConflictException('PRODUCTION_EXECUTION_NOT_DRAFT', 'Only a DRAFT execution can be confirmed.');
    }
    await this.payrollPeriodsService.assertDateNotClosed(execution.performedAt);

    let finalTotalAmount = Number(execution.totalAmount);

    if (execution.productionOrderId) {
      const order = await this.getStartedProductionOrder(execution.productionOrderId);
      const qtyCompleted = Number(execution.qtyCompleted ?? 0);
      finalTotalAmount = await this.computeAndValidateProductAmount(order, qtyCompleted);

      const assembly = await this.prisma.tenant.assembly.findUnique({ where: { id: order.assemblyId } });
      if (assembly && assembly.soloAllowed === false && execution.allocations.length < 2) {
        throw new CodedConflictException(
          'PRODUCTION_EXECUTION_SOLO_NOT_ALLOWED',
          'This assembly does not allow solo execution — at least 2 allocations are required.',
        );
      }
    } else {
      const workTask = await this.getOpenWorkTask(execution.workTaskId!);
      await this.assertGeneralFundAvailable(workTask, finalTotalAmount);
    }

    const rows = this.buildAllocationRows(
      execution.allocationMode,
      finalTotalAmount,
      execution.allocations.map((a) => ({
        employeeId: a.employeeId,
        percent: a.percent !== null ? Number(a.percent) : undefined,
        hours: a.hours !== null ? Number(a.hours) : undefined,
      })),
    );

    for (const alloc of execution.allocations) {
      const row = rows.find((r) => r.employeeId === alloc.employeeId)!;
      await this.prisma.tenant.productionExecutionAllocation.update({ where: { id: alloc.id }, data: { amount: row.amount } });

      const unitsProduced = execution.productionOrderId
        ? Number(execution.qtyCompleted ?? 0) * (finalTotalAmount > 0 ? row.amount / finalTotalAmount : 0)
        : undefined;

      await this.prisma.tenant.payrollEntry.create({
        data: {
          employeeId: alloc.employeeId,
          type: 'PIECEWORK',
          productionOrderId: execution.productionOrderId ?? undefined,
          unitsProduced,
          amount: row.amount,
          entryDate: execution.performedAt,
          comment: execution.productionOrderId
            ? `Production execution ${execution.id} (order ${execution.productionOrderId})`
            : `General work execution ${execution.id} (task ${execution.workTaskId})`,
          createdById: user.userId,
          sourceAllocationId: alloc.id,
        } as any,
      });
    }

    const updated = await this.prisma.tenant.productionExecution.update({
      where: { id },
      data: { status: 'CONFIRMED', totalAmount: finalTotalAmount, confirmedById: user.userId, confirmedAt: new Date() },
      include: { allocations: true },
    });

    if (execution.productionOrderId) {
      await this.stampConfirmedFinishedGoods(execution.productionOrderId, id, Number(execution.qtyCompleted ?? 0));
    }

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'production_execution.confirmed',
      entityType: 'ProductionExecution',
      entityId: id,
      after: updated,
    });
    return updated;
  }

  /**
   * Склад "В роботі" → "Готова продукція" (2026-08-30 user request): a
   * confirmed execution's own `qtyCompleted` is a genuine INCREMENT over
   * whatever was confirmed before (enforced by computeAndValidateProductAmount's
   * `confirmedQty + qtyCompleted <= unitsPlanned` invariant), so it FIFO-
   * matches against this order's oldest still-unstamped units — same
   * "oldest first, no other identity to match on" convention already used
   * for sub-assembly FIFO consumption elsewhere in this codebase. Units are
   * otherwise interchangeable within a batch (all frozen at the same
   * per-unit cost at start()), so which SPECIFIC serials get stamped by
   * which execution is not meaningful beyond "the batch is now this much
   * further confirmed" — reversed in full by void_() below.
   *
   * NOT scoped to `status: 'IN_STOCK'` (2026-08-31 fix — a sub-assembly
   * routinely gets consumed by its parent's own start() before the worker
   * who made it gets around to confirming the execution, especially once
   * the parent is itself given to production the same day; the units still
   * exist as CONSUMED FinishedGood rows, just no longer sitting in stock).
   * Matching regardless of status means a since-consumed/shipped unit can
   * still receive its confirmation stamp — without this, that sub-assembly
   * would forever read as neither "В роботі" (it's gone) nor "Що зроблено"
   * (never stamped) on the order's own production-units view.
   */
  private async stampConfirmedFinishedGoods(productionOrderId: string, executionId: string, qtyCompleted: number): Promise<void> {
    const qty = Math.floor(qtyCompleted);
    if (qty <= 0) return;
    const candidates = await this.prisma.tenant.finishedGood.findMany({
      where: { productionOrderId, confirmedByExecutionId: null },
      orderBy: { manufactureDate: 'asc' },
      take: qty,
    });
    if (candidates.length === 0) return;
    await this.prisma.tenant.finishedGood.updateMany({
      where: { id: { in: candidates.map((c) => c.id) } },
      data: { confirmedByExecutionId: executionId },
    });
  }

  /**
   * Compensates a CONFIRMED execution: one negative PayrollEntry per
   * original allocation (sourceAllocationId left null — that column
   * already points at the ORIGINAL positive entry for this allocation and
   * is @unique, so a compensating row can't reuse it; the comment carries
   * the traceback instead), then flips status to VOIDED. The original
   * execution/allocation/PayrollEntry rows are never touched — full
   * history stays visible.
   */
  async void_(user: RequestUser, id: string, dto: VoidProductionExecutionDto) {
    const execution = await this.findOne(user, id);
    if (execution.status !== 'CONFIRMED') {
      throw new CodedConflictException('PRODUCTION_EXECUTION_NOT_CONFIRMED', 'Only a CONFIRMED execution can be voided.');
    }
    const now = new Date();
    await this.payrollPeriodsService.assertDateNotClosed(now);

    for (const alloc of execution.allocations) {
      await this.prisma.tenant.payrollEntry.create({
        data: {
          employeeId: alloc.employeeId,
          type: 'PIECEWORK',
          productionOrderId: execution.productionOrderId ?? undefined,
          unitsProduced: undefined,
          amount: -Number(alloc.amount),
          entryDate: now,
          comment: `VOID compensation for execution ${execution.id}${dto.note ? ` — ${dto.note}` : ''}`,
          createdById: user.userId,
        } as any,
      });
    }

    const updated = await this.prisma.tenant.productionExecution.update({
      where: { id },
      data: { status: 'VOIDED', note: dto.note !== undefined ? dto.note : execution.note },
      include: { allocations: true },
    });

    if (execution.productionOrderId) {
      // Un-stamp — this voided execution no longer confirms anyone's labor
      // on those units, so they go back to "В роботі" until re-confirmed
      // (by this same batch's next execution, e.g. via correct() below).
      await this.prisma.tenant.finishedGood.updateMany({
        where: { confirmedByExecutionId: id },
        data: { confirmedByExecutionId: null },
      });
    }

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'production_execution.voided',
      entityType: 'ProductionExecution',
      entityId: id,
      before: execution,
      after: updated,
    });
    return updated;
  }

  /**
   * Correction = void the original (compensating entries) + create a fresh
   * DRAFT execution against the SAME parent, linked via supersedesId. The
   * replacement is left in DRAFT deliberately — it goes through the normal
   * confirm() endpoint like any other execution, so it gets the exact same
   * fund/solo guard checks rather than a special-cased bypass here.
   */
  async correct(user: RequestUser, id: string, dto: CorrectProductionExecutionDto) {
    const original = await this.findOne(user, id);
    if (original.status !== 'CONFIRMED') {
      throw new CodedConflictException('PRODUCTION_EXECUTION_NOT_CONFIRMED', 'Only a CONFIRMED execution can be corrected.');
    }

    await this.void_(user, id, { note: dto.note ? `Superseded — ${dto.note}` : 'Superseded by correction' });

    const replacement = await this.create(user, {
      productionOrderId: original.productionOrderId ?? undefined,
      workTaskId: original.workTaskId ?? undefined,
      performedAt: dto.performedAt,
      qtyCompleted: dto.qtyCompleted,
      method: dto.method,
      teamId: dto.teamId,
      allocationMode: dto.allocationMode,
      totalAmount: dto.totalAmount,
      allocations: dto.allocations,
      note: dto.note,
    });

    const linked = await this.prisma.tenant.productionExecution.update({
      where: { id: replacement.id },
      data: { supersedesId: id },
      include: { allocations: true },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'production_execution.corrected',
      entityType: 'ProductionExecution',
      entityId: id,
      after: { voided: id, replacement: linked.id },
    });
    return linked;
  }

  // ============================================================
  // Internal helpers
  // ============================================================

  private assertExactlyOneParent(productionOrderId?: string, workTaskId?: string) {
    if (Boolean(productionOrderId) === Boolean(workTaskId)) {
      throw new CodedBadRequestException(
        'PRODUCTION_EXECUTION_PARENT_XOR',
        'Exactly one of productionOrderId/workTaskId must be set.',
      );
    }
  }

  private async getStartedProductionOrder(productionOrderId: string) {
    const order = await this.prisma.tenant.productionOrder.findUnique({ where: { id: productionOrderId } });
    if (!order) throw new CodedNotFoundException('PRODUCTION_ORDER_NOT_FOUND', 'Production order not found.');
    if (order.status !== 'IN_PROGRESS' && order.status !== 'COMPLETED') {
      throw new CodedConflictException(
        'PRODUCTION_EXECUTION_ORDER_NOT_STARTED',
        'This production order has not been started yet — its labor fund is only frozen once started.',
      );
    }
    return order;
  }

  private async getOpenWorkTask(workTaskId: string) {
    const workTask = await this.prisma.tenant.workTask.findUnique({ where: { id: workTaskId } });
    if (!workTask) throw new CodedNotFoundException('WORK_TASK_NOT_FOUND', 'Work task not found.');
    if (workTask.status !== 'OPEN') {
      throw new CodedConflictException('WORK_TASK_CLOSED', 'This work task is closed — no new executions can be recorded against it.');
    }
    return workTask;
  }

  /** qty/amount invariant (locked spec #5): sum of CONFIRMED executions for a batch never exceeds unitsPlanned/laborCostEur. */
  private async computeAndValidateProductAmount(order: { id: string; unitsPlanned: any; laborCostEur: any }, qtyCompleted: number): Promise<number> {
    const unitsPlanned = Number(order.unitsPlanned);
    const laborCostEur = Number(order.laborCostEur ?? 0);
    const totalAmount = round2(unitsPlanned > 0 ? (qtyCompleted / unitsPlanned) * laborCostEur : 0);

    const confirmed = await this.prisma.tenant.productionExecution.findMany({
      where: { productionOrderId: order.id, status: 'CONFIRMED' },
    });
    const confirmedQty = confirmed.reduce((sum, e) => sum + Number(e.qtyCompleted ?? 0), 0);
    const confirmedAmount = confirmed.reduce((sum, e) => sum + Number(e.totalAmount), 0);

    if (confirmedQty + qtyCompleted > unitsPlanned + FUND_EPSILON) {
      throw new CodedConflictException(
        'PRODUCTION_EXECUTION_QTY_EXCEEDS_PLANNED',
        `Quantity exceeds this batch's remaining unitsPlanned (${Math.max(unitsPlanned - confirmedQty, 0).toFixed(3)} left).`,
      );
    }
    if (confirmedAmount + totalAmount > laborCostEur + FUND_EPSILON) {
      throw new CodedConflictException(
        'PRODUCTION_EXECUTION_AMOUNT_EXCEEDS_FUND',
        `Amount exceeds this batch's remaining labor fund (€${Math.max(laborCostEur - confirmedAmount, 0).toFixed(2)} left).`,
      );
    }
    return totalAmount;
  }

  /** GENERAL analogue of the above, reusing WorkTask.fund as the ceiling — no new field, same guard shape. */
  private async assertGeneralFundAvailable(workTask: { id: string; fund: any }, totalAmount: number) {
    const fund = Number(workTask.fund);
    const confirmed = await this.prisma.tenant.productionExecution.findMany({
      where: { workTaskId: workTask.id, status: 'CONFIRMED' },
    });
    const confirmedAmount = confirmed.reduce((sum, e) => sum + Number(e.totalAmount), 0);
    if (confirmedAmount + totalAmount > fund + FUND_EPSILON) {
      throw new CodedConflictException(
        'WORK_TASK_AMOUNT_EXCEEDS_FUND',
        `Amount exceeds this work task's remaining fund (€${Math.max(fund - confirmedAmount, 0).toFixed(2)} left).`,
      );
    }
  }

  private assertAllocationsValid(mode: string, allocations: ProductionExecutionAllocationDto[]) {
    const seen = new Set<string>();
    for (const a of allocations) {
      if (seen.has(a.employeeId)) {
        throw new CodedConflictException('PRODUCTION_EXECUTION_ALLOCATION_DUPLICATE', `Employee ${a.employeeId} is listed more than once.`);
      }
      seen.add(a.employeeId);
      if (mode === 'PERCENT' && (a.percent === undefined || a.percent < 0)) {
        throw new CodedBadRequestException('PRODUCTION_EXECUTION_ALLOCATION_PERCENT_REQUIRED', 'Every allocation needs a non-negative percent when allocationMode=PERCENT.');
      }
      if (mode === 'HOURS' && (a.hours === undefined || a.hours < 0)) {
        throw new CodedBadRequestException('PRODUCTION_EXECUTION_ALLOCATION_HOURS_REQUIRED', 'Every allocation needs a non-negative hours value when allocationMode=HOURS.');
      }
    }
    const weightSum = allocations.reduce((s, a) => s + Number((mode === 'PERCENT' ? a.percent : a.hours) ?? 0), 0);
    if (weightSum <= 0) {
      throw new CodedBadRequestException('PRODUCTION_EXECUTION_ALLOCATION_WEIGHTS_ALL_ZERO', 'At least one allocation must have a positive weight.');
    }
  }

  /**
   * Splits totalAmount across allocations by PERCENT or HOURS weight,
   * normalized (weights need not already sum to 100 — same convention as
   * ProductionOrdersService's worker percentages). Rounds every row but the
   * last to 2 decimals, then sets the last row to whatever's left so the
   * allocations always sum to EXACTLY totalAmount (no floating-point drift).
   */
  private buildAllocationRows(mode: string, totalAmount: number, allocations: ProductionExecutionAllocationDto[]): AllocationRow[] {
    const weights = allocations.map((a) => Number((mode === 'PERCENT' ? a.percent : a.hours) ?? 0));
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    const amounts = weights.map((w) => round2(totalWeight > 0 ? totalAmount * (w / totalWeight) : 0));
    if (amounts.length > 0) {
      const sumExceptLast = amounts.slice(0, -1).reduce((s, a) => s + a, 0);
      amounts[amounts.length - 1] = round2(totalAmount - sumExceptLast);
    }
    return allocations.map((a, i) => ({
      employeeId: a.employeeId,
      percent: mode === 'PERCENT' ? a.percent : undefined,
      hours: mode === 'HOURS' ? a.hours : undefined,
      amount: amounts[i],
    }));
  }

  private allocationCreateData(row: AllocationRow) {
    return { employeeId: row.employeeId, percent: row.percent, hours: row.hours, amount: row.amount };
  }
}
