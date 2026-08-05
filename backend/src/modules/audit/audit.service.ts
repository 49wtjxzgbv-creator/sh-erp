import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { QueryAuditEventsDto } from './dto/query-audit-events.dto';

export interface LogAuditEventInput {
  companyId: string;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * Generic audit trail — replaces the old free-text History sheet's
 * catch-all half (Phase 1 §3.2's `logHistory_`, Phase 3 §6's documented
 * split: stock-quantity events go to StockMovement instead, everything
 * else lands here). Other modules call `record()` as a side effect of
 * their own mutations; this module itself only exposes read access.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes one audit row. Deliberately takes a plain companyId rather than
   * relying on the AsyncLocalStorage tenant context, so background jobs and
   * the Phase 4 migration engine (which run outside a request's tenant
   * context) can log too. Uses the raw client, not `.tenant`, for the same
   * reason — the caller is always explicit about which company this event
   * belongs to.
   */
  async record(input: LogAuditEventInput): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        companyId: input.companyId,
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        before: input.before === undefined ? undefined : (input.before as any),
        after: input.after === undefined ? undefined : (input.after as any),
        metadata: input.metadata === undefined ? undefined : (input.metadata as any),
      },
    });
  }

  async findForEntity(user: RequestUser, entityType: string, entityId: string) {
    return this.prisma.tenant.auditEvent.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async query(user: RequestUser, query: QueryAuditEventsDto) {
    const where: Record<string, any> = {};
    if (query.entityType) where.entityType = query.entityType;
    if (query.actorUserId) where.actorUserId = query.actorUserId;
    if (query.action) where.action = query.action;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    const take = query.limit ?? 50;
    const skip = query.offset ?? 0;

    const [items, total] = await Promise.all([
      this.prisma.tenant.auditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.tenant.auditEvent.count({ where }),
    ]);

    return { items, total, limit: take, offset: skip };
  }
}
