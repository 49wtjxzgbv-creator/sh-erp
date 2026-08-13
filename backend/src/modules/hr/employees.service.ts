import { Injectable } from '@nestjs/common';
import { CodedNotFoundException } from '../../common/api-exceptions';
import { Prisma } from '@prisma/client';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateEmployeeDto, QueryEmployeesDto, UpdateEmployeeDto } from './dto/employee.dto';

/**
 * Employees.gs (Phase 1 §3.5) — admin-only (enforced by the `employees:manage`
 * permission, granted only to Admin in DEFAULT_ROLES). Deactivate-only,
 * NEVER hard-deleted — this preserves payroll linkage (`PayrollEntry.employee`
 * is `onDelete: Restrict`, so a hard delete would be blocked at the DB layer
 * anyway; deactivation via `EmployeeStatus` is the only removal path this
 * schema actually supports, matching the legacy behavior exactly).
 */
@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(user: RequestUser, dto: CreateEmployeeDto) {
    const employee = await this.prisma.tenant.employee.create({ data: dto as any });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'employee.created',
      entityType: 'Employee',
      entityId: employee.id,
      after: employee,
    });
    return employee;
  }

  async findOne(user: RequestUser, id: string) {
    const employee = await this.prisma.tenant.employee.findUnique({ where: { id } });
    if (!employee) throw new CodedNotFoundException('EMPLOYEE_NOT_FOUND', 'Employee not found.');
    return employee;
  }

  async query(user: RequestUser, query: QueryEmployeesDto) {
    const where: Prisma.EmployeeWhereInput = { status: (query.status as any) ?? 'ACTIVE' };
    if (query.search) where.fullName = { contains: query.search, mode: 'insensitive' };

    const take = query.limit ?? 50;
    const skip = query.offset ?? 0;
    const [items, total] = await Promise.all([
      this.prisma.tenant.employee.findMany({ where, orderBy: { fullName: 'asc' }, take, skip }),
      this.prisma.tenant.employee.count({ where }),
    ]);
    return { items, total, limit: take, offset: skip };
  }

  async update(user: RequestUser, id: string, dto: UpdateEmployeeDto) {
    const before = await this.findOne(user, id);
    const employee = await this.prisma.tenant.employee.update({ where: { id }, data: dto as any });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'employee.updated',
      entityType: 'Employee',
      entityId: id,
      before,
      after: employee,
    });
    return employee;
  }

  async deactivate(user: RequestUser, id: string) {
    const before = await this.findOne(user, id);
    const employee = await this.prisma.tenant.employee.update({ where: { id }, data: { status: 'INACTIVE' } });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'employee.deactivated',
      entityType: 'Employee',
      entityId: id,
      before,
      after: employee,
    });
    return employee;
  }

  async reactivate(user: RequestUser, id: string) {
    const before = await this.findOne(user, id);
    const employee = await this.prisma.tenant.employee.update({ where: { id }, data: { status: 'ACTIVE' } });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'employee.reactivated',
      entityType: 'Employee',
      entityId: id,
      before,
      after: employee,
    });
    return employee;
  }
}
