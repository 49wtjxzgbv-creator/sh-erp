import { Injectable } from '@nestjs/common';
import { CodedConflictException, CodedNotFoundException } from '../../common/api-exceptions';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateWorkTaskDto, QueryWorkTasksDto, SetWorkTaskItemsDto, UpdateWorkTaskDto } from './dto/work-task.dto';

/**
 * GENERAL work (locked spec #7): has no ProductionOrder, its fund is set
 * manually here (never derived from Assembly.laborCostPerUnit — there is
 * no assembly), and its optional WorkTaskItem tags are informational only
 * (reporting a link to a product the work touched) — never read by any
 * fund/allocation calculation, and never reduce any ProductionOrder's own
 * fund.
 */
@Injectable()
export class WorkTasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(user: RequestUser, dto: CreateWorkTaskDto) {
    const workTask = await this.prisma.tenant.workTask.create({
      data: { title: dto.title, fund: dto.fund, status: 'OPEN', createdById: user.userId } as any,
    });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'work_task.created',
      entityType: 'WorkTask',
      entityId: workTask.id,
      after: workTask,
    });
    return workTask;
  }

  async query(user: RequestUser, query: QueryWorkTasksDto) {
    const where: Record<string, any> = {};
    if (query.status) where.status = query.status;

    const take = query.limit ?? 50;
    const skip = query.offset ?? 0;
    const [items, total] = await Promise.all([
      this.prisma.tenant.workTask.findMany({
        where,
        include: { items: { include: { customerOrderItem: true } } },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.tenant.workTask.count({ where }),
    ]);
    return { items, total, limit: take, offset: skip };
  }

  async findOne(user: RequestUser, id: string) {
    const workTask = await this.prisma.tenant.workTask.findUnique({
      where: { id },
      include: { items: { include: { customerOrderItem: true } } },
    });
    if (!workTask) throw new CodedNotFoundException('WORK_TASK_NOT_FOUND', 'Work task not found.');
    return workTask;
  }

  async update(user: RequestUser, id: string, dto: UpdateWorkTaskDto) {
    const before = await this.findOne(user, id);
    if (dto.fund !== undefined) {
      const confirmed = await this.prisma.tenant.productionExecution.findMany({
        where: { workTaskId: id, status: 'CONFIRMED' },
      });
      const confirmedAmount = confirmed.reduce((sum, e) => sum + Number(e.totalAmount), 0);
      if (dto.fund < confirmedAmount) {
        throw new CodedConflictException(
          'WORK_TASK_FUND_BELOW_CONFIRMED',
          `Cannot lower fund below what CONFIRMED executions have already drawn (€${confirmedAmount.toFixed(2)}).`,
        );
      }
    }
    const workTask = await this.prisma.tenant.workTask.update({
      where: { id },
      data: { ...(dto.title !== undefined ? { title: dto.title } : {}), ...(dto.fund !== undefined ? { fund: dto.fund } : {}) },
    });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'work_task.updated',
      entityType: 'WorkTask',
      entityId: id,
      before,
      after: workTask,
    });
    return workTask;
  }

  async setItems(user: RequestUser, id: string, dto: SetWorkTaskItemsDto) {
    const before = await this.findOne(user, id);
    const uniqueIds = Array.from(new Set(dto.customerOrderItemIds));
    await this.prisma.tenant.workTaskItem.deleteMany({ where: { workTaskId: id } });
    if (uniqueIds.length > 0) {
      await this.prisma.tenant.workTaskItem.createMany({
        data: uniqueIds.map((customerOrderItemId) => ({ workTaskId: id, customerOrderItemId })) as any,
      });
    }
    const after = await this.findOne(user, id);
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'work_task.items_set',
      entityType: 'WorkTask',
      entityId: id,
      before,
      after,
    });
    return after;
  }

  async close(user: RequestUser, id: string) {
    const before = await this.findOne(user, id);
    if (before.status === 'CLOSED') {
      throw new CodedConflictException('WORK_TASK_ALREADY_CLOSED', 'This work task is already closed.');
    }
    const workTask = await this.prisma.tenant.workTask.update({ where: { id }, data: { status: 'CLOSED' } });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'work_task.closed',
      entityType: 'WorkTask',
      entityId: id,
      before,
      after: workTask,
    });
    return workTask;
  }

  async reopen(user: RequestUser, id: string) {
    const before = await this.findOne(user, id);
    if (before.status === 'OPEN') {
      throw new CodedConflictException('WORK_TASK_ALREADY_OPEN', 'This work task is already open.');
    }
    const workTask = await this.prisma.tenant.workTask.update({ where: { id }, data: { status: 'OPEN' } });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'work_task.reopened',
      entityType: 'WorkTask',
      entityId: id,
      before,
      after: workTask,
    });
    return workTask;
  }

  /** Guards what the DB's CHECK constraint would otherwise reject as a raw error: ProductionExecution.workTaskId is SET NULL on delete, which would leave a GENERAL execution with BOTH parents null, violating production_executions_exactly_one_parent. */
  async remove(user: RequestUser, id: string) {
    const before = await this.findOne(user, id);
    const executionCount = await this.prisma.tenant.productionExecution.count({ where: { workTaskId: id } });
    if (executionCount > 0) {
      throw new CodedConflictException(
        'WORK_TASK_HAS_EXECUTIONS',
        `Cannot delete: ${executionCount} execution(s) recorded against this task. Void/remove them first.`,
      );
    }
    await this.prisma.tenant.workTask.delete({ where: { id } });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'work_task.deleted',
      entityType: 'WorkTask',
      entityId: id,
      before,
    });
  }
}
