import { Injectable } from '@nestjs/common';
import { SuperAdminPrismaService } from './super-admin-prisma.service';

export interface LogSuperAdminActionInput {
  superAdminId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Separate from the regular `AuditService` on purpose — a super-admin
 * action (blocking a company, changing a plan, impersonating a user) often
 * has no single tenant `companyId` to attach to, and `AuditEvent.companyId`
 * is required/RLS-scoped (see schema.prisma's SuperAdminAuditLog comment).
 * Every mutating endpoint in this module calls `record()` as a side effect,
 * same convention as the regular AuditService.
 */
@Injectable()
export class SuperAdminAuditService {
  constructor(private readonly prisma: SuperAdminPrismaService) {}

  async record(input: LogSuperAdminActionInput): Promise<void> {
    await this.prisma.superAdminAuditLog.create({
      data: {
        superAdminId: input.superAdminId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        metadata: input.metadata === undefined ? undefined : (input.metadata as any),
      },
    });
  }

  async query(limit = 50, offset = 0) {
    const [items, total] = await Promise.all([
      this.prisma.superAdminAuditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: { superAdmin: { select: { id: true, email: true, fullName: true } } },
      }),
      this.prisma.superAdminAuditLog.count(),
    ]);
    return { items, total, limit, offset };
  }
}
