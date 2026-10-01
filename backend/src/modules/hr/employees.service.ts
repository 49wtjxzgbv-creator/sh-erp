import { Injectable } from '@nestjs/common';
import { CodedConflictException, CodedNotFoundException } from '../../common/api-exceptions';
import { Prisma } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateEmployeeDto, QueryEmployeesDto, UpdateEmployeeDto } from './dto/employee.dto';

const TELEGRAM_PAIRING_CODE_TTL_MINUTES = 15;
const TELEGRAM_PAIRING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — avoids a typed-by-hand mixup

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

  /**
   * "Бот через який працівники зможуть подавати виконану роботу"
   * (2026-10-01) — generates the one-time code an employee sends to the
   * shared platform Telegram bot (`/start <code>`) to link their account.
   * `telegramPairingCode` is globally unique (one shared bot across every
   * company — see that field's own schema comment), so collisions are
   * retried rather than assumed impossible. `telegramLinkedByUserId` is
   * recorded now (not at pairing time) since this is the authenticated
   * step — it's reused later as every bot-submitted
   * ProductionExecution.recordedById.
   */
  async generateTelegramPairingCode(user: RequestUser, id: string) {
    await this.findOne(user, id);
    const expiresAt = new Date(Date.now() + TELEGRAM_PAIRING_CODE_TTL_MINUTES * 60_000);

    // `telegramPairingCode` is globally unique (one shared bot across every
    // company — RLS would hide another tenant's row from a pre-check
    // against `this.prisma.tenant`, so uniqueness is enforced by retrying
    // on the real DB constraint violation (P2002) instead of a tenant-
    // scoped "does this code already exist" read, which could wrongly say
    // no.
    let employee;
    let code = '';
    for (let attempt = 0; attempt < 10; attempt++) {
      code = this.randomPairingCode();
      try {
        employee = await this.prisma.tenant.employee.update({
          where: { id },
          data: { telegramPairingCode: code, telegramPairingCodeExpiresAt: expiresAt, telegramLinkedByUserId: user.userId },
        });
        break;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
        throw err;
      }
    }
    if (!employee) {
      throw new CodedConflictException('TELEGRAM_PAIRING_CODE_GENERATION_FAILED', 'Could not generate a unique pairing code — try again.');
    }

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'employee.telegram_pairing_code_generated',
      entityType: 'Employee',
      entityId: id,
      after: { telegramPairingCodeExpiresAt: employee.telegramPairingCodeExpiresAt },
    });
    return { pairingCode: code, expiresAt: employee.telegramPairingCodeExpiresAt };
  }

  /** Unlinks a previously paired Telegram account — e.g. staff turnover, or the employee got a new phone/account. A fresh pairing code can be generated right after. */
  async unlinkTelegram(user: RequestUser, id: string) {
    const before = await this.findOne(user, id);
    const employee = await this.prisma.tenant.employee.update({
      where: { id },
      data: {
        telegramChatId: null,
        telegramLinkedAt: null,
        telegramPendingProductionOrderId: null,
        telegramPairingCode: null,
        telegramPairingCodeExpiresAt: null,
      },
    });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'employee.telegram_unlinked',
      entityType: 'Employee',
      entityId: id,
      before: { telegramChatId: before.telegramChatId },
      after: employee,
    });
    return employee;
  }

  private randomPairingCode(): string {
    return Array.from({ length: 6 }, () => TELEGRAM_PAIRING_CODE_ALPHABET[randomInt(TELEGRAM_PAIRING_CODE_ALPHABET.length)]).join('');
  }
}
