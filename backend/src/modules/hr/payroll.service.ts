import { Injectable } from '@nestjs/common';
import { CodedBadRequestException } from '../../common/api-exceptions';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PayrollSummaryQueryDto, QueryPayrollEntriesDto, RecordPayrollEntryDto } from './dto/payroll-entry.dto';
import { PayrollPeriodsService } from './payroll-periods.service';

/**
 * One (employee, article) bucket of PIECEWORK output for the period — "яку
 * кількість якого артикулу зробив" (2026-08-28 user request). `assemblyId
 * null` is the real "no article" bucket: a WorkTask-based PIECEWORK entry
 * (general labor, never linked to a ProductionOrder/Assembly at all — see
 * WorkTaskItem.customerOrderItemId's own schema comment) or a
 * ProductionOrder whose Assembly was hard-deleted after the fact. Never
 * dropped silently — always present under `article: null` instead.
 */
export interface PayrollArticleLine {
  assemblyId: string | null;
  assemblyName: string | null;
  article: string | null;
  unitsProduced: number;
  amount: number;
}

export interface PayrollSummaryLine {
  employeeId: string;
  employeeName: string;
  piecework: number;
  advances: number;
  bonuses: number;
  penalties: number;
  netTotal: number;
  defectCount: number;
  byArticle: PayrollArticleLine[];
}

/**
 * Manual advance/bonus/penalty ledger entries (Payroll.gs, Phase 1 §3.5).
 * PIECEWORK entries are never created here — they're generated only by
 * `ProductionExecutionsService#confirm` (production-labor module,
 * 2026-08-24), one row per confirmed allocation. This service only handles
 * the 3 manual types plus the cross-referenced summary report.
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
    private readonly payrollPeriodsService: PayrollPeriodsService,
  ) {}

  /** Applies the sign convention (ADVANCE/PENALTY negative, BONUS positive, Phase 1 §3.5) so callers only ever pass a positive magnitude. */
  async recordManualEntry(user: RequestUser, dto: RecordPayrollEntryDto) {
    const employee = await this.prisma.tenant.employee.findUnique({ where: { id: dto.employeeId } });
    if (!employee) {
      throw new CodedBadRequestException('EMPLOYEE_NOT_FOUND', 'Employee not found.');
    }
    await this.payrollPeriodsService.assertDateNotClosed(dto.entryDate ?? new Date());

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

    // Article breakdown for PIECEWORK entries: PayrollEntry only carries
    // productionOrderId, never assemblyId/article directly — resolved here
    // via ProductionOrder -> Assembly, batched (same "fetch once, join in
    // memory" discipline as the defect-count join above) rather than
    // per-entry.
    const productionOrderIds = Array.from(new Set((entries as any[]).map((e) => e.productionOrderId).filter((id): id is string => Boolean(id))));
    const productionOrders = productionOrderIds.length
      ? await this.prisma.tenant.productionOrder.findMany({ where: { id: { in: productionOrderIds } }, select: { id: true, assemblyId: true } })
      : [];
    const assemblyIdByOrderId = new Map((productionOrders as any[]).map((o) => [o.id, o.assemblyId]));
    const assemblyIds = Array.from(new Set((productionOrders as any[]).map((o) => o.assemblyId)));
    const assemblies = assemblyIds.length
      ? await this.prisma.tenant.assembly.findMany({ where: { id: { in: assemblyIds } }, select: { id: true, name: true, article: true } })
      : [];
    const assemblyById = new Map((assemblies as any[]).map((a) => [a.id, a]));

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
    const articlesByEmployee = new Map<string, Map<string, PayrollArticleLine>>();
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
          byArticle: [],
        });
      }
      return summaryByEmployee.get(employeeId)!;
    };

    const GENERAL_WORK_KEY = '__general__';
    const ensureArticleLine = (employeeId: string, assemblyId: string | null): PayrollArticleLine => {
      let byArticle = articlesByEmployee.get(employeeId);
      if (!byArticle) {
        byArticle = new Map();
        articlesByEmployee.set(employeeId, byArticle);
      }
      const key = assemblyId ?? GENERAL_WORK_KEY;
      if (!byArticle.has(key)) {
        const assembly = assemblyId ? assemblyById.get(assemblyId) : null;
        byArticle.set(key, {
          assemblyId,
          assemblyName: assembly?.name ?? null,
          article: assembly?.article ?? null,
          unitsProduced: 0,
          amount: 0,
        });
      }
      return byArticle.get(key)!;
    };

    for (const entry of entries as any[]) {
      const line = ensureLine(entry.employeeId);
      const amount = Number(entry.amount);
      if (entry.type === 'PIECEWORK') {
        line.piecework += amount;
        const assemblyId = entry.productionOrderId ? (assemblyIdByOrderId.get(entry.productionOrderId) ?? null) : null;
        const articleLine = ensureArticleLine(entry.employeeId, assemblyId);
        articleLine.unitsProduced += Number(entry.unitsProduced ?? 0);
        articleLine.amount += amount;
      } else if (entry.type === 'ADVANCE') line.advances += amount;
      else if (entry.type === 'BONUS') line.bonuses += amount;
      else if (entry.type === 'PENALTY') line.penalties += amount;
      line.netTotal += amount;
    }

    // Include employees with a defect count but zero payroll entries in the period too, so the report never silently drops them.
    for (const employeeId of defectCountByEmployee.keys()) {
      ensureLine(employeeId);
    }

    for (const [employeeId, line] of summaryByEmployee) {
      const byArticle = articlesByEmployee.get(employeeId);
      line.byArticle = byArticle
        ? Array.from(byArticle.values()).sort((a, b) => {
            if (a.assemblyId === null) return 1; // general work (no article) always sorts last
            if (b.assemblyId === null) return -1;
            return (a.article ?? '').localeCompare(b.article ?? '');
          })
        : [];
    }

    return Array.from(summaryByEmployee.values()).sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  }
}
