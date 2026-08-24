import { Injectable } from '@nestjs/common';
import { CodedConflictException, CodedNotFoundException } from '../../common/api-exceptions';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreatePayrollPeriodDto, QueryPayrollPeriodsDto } from './dto/payroll-period.dto';

/**
 * Locked spec #13: a CLOSED PayrollPeriod blocks create/confirm/void of
 * anything payroll-affecting whose date falls inside it — manual
 * PayrollEntry entries (PayrollService) and ProductionExecution
 * create/confirm/void (ProductionExecutionsService, injected across
 * modules via HrModule's export, same shape as ProductionModule already
 * importing InventoryModule for StockService).
 */
@Injectable()
export class PayrollPeriodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(user: RequestUser, dto: CreatePayrollPeriodDto) {
    if (dto.periodEnd < dto.periodStart) {
      throw new CodedConflictException('PAYROLL_PERIOD_INVALID_RANGE', 'periodEnd must not be before periodStart.');
    }
    const period = await this.prisma.tenant.payrollPeriod.create({
      data: { periodStart: dto.periodStart, periodEnd: dto.periodEnd } as any,
    });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'payroll_period.created',
      entityType: 'PayrollPeriod',
      entityId: period.id,
      after: period,
    });
    return period;
  }

  async query(user: RequestUser, query: QueryPayrollPeriodsDto) {
    const take = query.limit ?? 50;
    const skip = query.offset ?? 0;
    const [items, total] = await Promise.all([
      this.prisma.tenant.payrollPeriod.findMany({ orderBy: { periodStart: 'desc' }, take, skip }),
      this.prisma.tenant.payrollPeriod.count(),
    ]);
    return { items, total, limit: take, offset: skip };
  }

  async findOne(user: RequestUser, id: string) {
    const period = await this.prisma.tenant.payrollPeriod.findUnique({ where: { id } });
    if (!period) throw new CodedNotFoundException('PAYROLL_PERIOD_NOT_FOUND', 'Payroll period not found.');
    return period;
  }

  async close(user: RequestUser, id: string) {
    const before = await this.findOne(user, id);
    if (before.status === 'CLOSED') {
      throw new CodedConflictException('PAYROLL_PERIOD_ALREADY_CLOSED', 'This payroll period is already closed.');
    }
    const period = await this.prisma.tenant.payrollPeriod.update({
      where: { id },
      data: { status: 'CLOSED', closedById: user.userId, closedAt: new Date() },
    });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'payroll_period.closed',
      entityType: 'PayrollPeriod',
      entityId: id,
      before,
      after: period,
    });
    return period;
  }

  async reopen(user: RequestUser, id: string) {
    const before = await this.findOne(user, id);
    if (before.status === 'OPEN') {
      throw new CodedConflictException('PAYROLL_PERIOD_ALREADY_OPEN', 'This payroll period is already open.');
    }
    const period = await this.prisma.tenant.payrollPeriod.update({
      where: { id },
      data: { status: 'OPEN', closedById: null, closedAt: null },
    });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'payroll_period.reopened',
      entityType: 'PayrollPeriod',
      entityId: id,
      before,
      after: period,
    });
    return period;
  }

  /** Throws if `date` falls inside any CLOSED period for this tenant. Used by every payroll-affecting write (locked spec #13). */
  async assertDateNotClosed(date: Date) {
    const closed = await this.prisma.tenant.payrollPeriod.findFirst({
      where: { status: 'CLOSED', periodStart: { lte: date }, periodEnd: { gte: date } },
    });
    if (closed) {
      throw new CodedConflictException(
        'PAYROLL_PERIOD_CLOSED',
        `This date falls inside a closed payroll period (${closed.periodStart.toISOString().slice(0, 10)} – ${closed.periodEnd.toISOString().slice(0, 10)}).`,
      );
    }
  }
}
