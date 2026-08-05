import { BadRequestException, Injectable } from '@nestjs/common';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PayrollSummaryQueryDto, QueryPayrollEntriesDto, RecordPayrollEntryDto } from './dto/payroll-entry.dto';

export interface PayrollSummaryLine {
  employeeId: string;
  employeeName: string;
  piecework: number;
  advances: number;
  bonuses: number;
  penalties: number;
  netTotal: number;
  defectCount: number;
}

/**
 * Manual advance/bonus/penalty ledger entries (Payroll.gs, Phase 1 §3.5).
 * PIECEWORK entries are never created here — they're system-generated from
 * `ProductionOrdersService.start()` (Module 6), split by assigned-worker
 * percentage. This service only handles the 3 manual types plus the
 * cross-referenced summary report.
 *
 * `PayrollEntry` is an immutable ledger (no `updatedAt`/`deletedAt` in the
 * schema, and the DB grants in database-schema.md §2 revoke UPDATE/DELETE
 * on it for `app_user`) — a correction is always a new offsetting entry,
 * never an edit, matching every other immutable-ledger table in this
 * schema (`AuditEvent`, `StockMovement`, `AssemblyVersion`).
 */
@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /** Applies the sign convention (ADVANCE/PENALTY negative, BONUS positive, Phase 1 §3.5) so callers only ever pass a positive magnitude. */
  async recordManualEntry(user: RequestUser, dto: RecordPayrollEntryDto) {
    const employee = await this.prisma.tenant.employee.findUnique({ where: { id: dto.employeeId } });
    if (!employee) {
      throw new BadRequestException('Employee not found.');
    }

    const signedAmount = dto.type === 'BONUS' ? Math.abs(dto.amount) : -Math.abs(dto.amount);

    const entry = await this.prisma.tenant.payrollEntry.create({
      data: {
        employeeId: dto.employeeId,
        type: dto.type,
        amount: signedAmount,
        entryDate: dto.entryDate,
        comment: dto.comment,
        createdById: user.userId,
      } as any,
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: `payroll.${dto.type.toLowerCase()}_recorded`,
      entityType: 'PayrollEntry',
      entityId: entry.id,
      after: entry,
    });
    return entry;
  }

  async query(user: RequestUser, query: QueryPayrollEntriesDto) {
    const where: Record<string, any> = {};
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.type) where.type = query.type;

    const take = query.limit ?? 50;
    const skip = query.offset ?? 0;
    const [items, total] = await Promise.all([
      this.prisma.tenant.payrollEntry.findMany({ where, orderBy: { entryDate: 'desc' }, take, skip }),
      this.prisma.tenant.payrollEntry.count({ where }),
    ]);
    return { items, total, limit: take, offset: skip };
  }

  /**
   * Per-employee totals by type, plus a defect count cross-referenced from
   * QC results (`getPayrollSummaryReport`, Phase 1 §3.5/§6.5): a REWORK
   * result doesn't touch payroll directly — this join is computed at
   * report time, walking `QcCheck.result='REWORK'` back through
   * `FinishedGood.productionOrderId` to each employee's assigned orders
   * (`ProductionOrderWorker`). Every list this needs is fetched ONCE up
   * front and joined in memory, not per-employee — the legacy codebase
   * itself documents fixing a real performance issue caused by exactly
   * that N+1 pattern for a similar reservation calculation (Phase 1
   * §3.3's `getReservedQtyMap_` note), so the same discipline is applied
   * here from the start.
   */
  async getPayrollSummaryReport(user: RequestUser, query: PayrollSummaryQueryDto): Promise<PayrollSummaryLine[]> {
    const entryWhere: Record<string, any> = {};
    if (query.from || query.to) {
      entryWhere.entryDate = {};
      if (query.from) entryWhere.entryDate.gte = new Date(query.from);
      if (query.to) entryWhere.entryDate.lte = new Date(query.to);
    }

    const [entries, employees, workerAssignments, finishedGoods, reworkChecks] = await Promise.all([
      this.prisma.tenant.payrollEntry.findMany({ where: entryWhere }),
      this.prisma.tenant.employee.findMany(),
      this.prisma.tenant.productionOrderWorker.findMany(),
      this.prisma.tenant.finishedGood.findMany(), // productionOrderId is a required field on this model — every row has one
      this.prisma.tenant.qcCheck.findMany({ where: { result: 'REWORK' } }),
    ]);

    const reworkFinishedGoodIds = new Set((reworkChecks as any[]).map((c) => c.finishedGoodId));

    // productionOrderId -> count of that order's finished goods with a REWORK check
    const defectCountByProductionOrder = new Map<string, number>();
    for (const good of finishedGoods as any[]) {
      if (reworkFinishedGoodIds.has(good.id)) {
        defectCountByProductionOrder.set(
          good.productionOrderId,
          (defectCountByProductionOrder.get(good.productionOrderId) ?? 0) + 1,
        );
      }
    }

    // employeeId -> total defect count across every order they were assigned to
    const defectCountByEmployee = new Map<string, number>();
    for (const assignment of workerAssignments as any[]) {
      const orderDefects = defectCountByProductionOrder.get(assignment.productionOrderId) ?? 0;
      if (orderDefects > 0) {
        defectCountByEmployee.set(assignment.employeeId, (defectCountByEmployee.get(assignment.employeeId) ?? 0) + orderDefects);
      }
    }

    const summaryByEmployee = new Map<string, PayrollSummaryLine>();
    const employeeById = new Map<string, any>();
    for (const e of employees as any[]) employeeById.set(e.id, e);

    const ensureLine = (employeeId: string): PayrollSummaryLine => {
      if (!summaryByEmployee.has(employeeId)) {
        summaryByEmployee.set(employeeId, {
          employeeId,
          employeeName: employeeById.get(employeeId)?.fullName ?? employeeId,
          piecework: 0,
          advances: 0,
          bonuses: 0,
          penalties: 0,
          netTotal: 0,
          defectCount: defectCountByEmployee.get(employeeId) ?? 0,
        });
      }
      return summaryByEmployee.get(employeeId)!;
    };

    for (const entry of entries as any[]) {
      const line = ensureLine(entry.employeeId);
      const amount = Number(entry.amount);
      if (entry.type === 'PIECEWORK') line.piecework += amount;
      else if (entry.type === 'ADVANCE') line.advances += amount;
      else if (entry.type === 'BONUS') line.bonuses += amount;
      else if (entry.type === 'PENALTY') line.penalties += amount;
      line.netTotal += amount;
    }

    // Include employees with a defect count but zero payroll entries in the period too, so the report never silently drops them.
    for (const employeeId of defectCountByEmployee.keys()) {
      ensureLine(employeeId);
    }

    return Array.from(summaryByEmployee.values()).sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  }
}
