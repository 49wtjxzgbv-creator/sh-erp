import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { CodedNotFoundException } from '../../common/api-exceptions';
import { PrismaService } from '../../prisma/prisma.service';

export interface QueryFinishedGoodsInput {
  assemblyId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

/**
 * Per-unit serial tracking (FinishedGoods.gs, Phase 1 §3.3). Serial
 * generation is the one place the legacy code used an explicit lock
 * (`LockService`, 10s wait) to avoid duplicate serials under concurrent
 * production-order starts. The Postgres-native equivalent used here is a
 * transaction-scoped advisory lock (`pg_advisory_xact_lock`, auto-released
 * at COMMIT/ROLLBACK) keyed by companyId — every FinishedGood-creating
 * request already runs inside one transaction (`TenantScopeInterceptor`),
 * so this serializes serial-number generation per company without any new
 * schema (no counter column needed — genuinely just a locking-strategy
 * translation, not an architecture change).
 */
@Injectable()
export class FinishedGoodsService {
  constructor(private readonly prisma: PrismaService) {}

  async findOne(user: RequestUser, id: string) {
    const good = await this.prisma.tenant.finishedGood.findUnique({ where: { id } });
    if (!good) throw new CodedNotFoundException('FINISHED_GOOD_NOT_FOUND', 'Finished good not found.');
    return good;
  }

  async query(user: RequestUser, query: QueryFinishedGoodsInput) {
    const where: Prisma.FinishedGoodWhereInput = {};
    if (query.assemblyId) where.assemblyId = query.assemblyId;
    if (query.status) where.status = query.status as any;

    const take = query.limit ?? 50;
    const skip = query.offset ?? 0;
    const [items, total] = await Promise.all([
      this.prisma.tenant.finishedGood.findMany({ where, orderBy: { manufactureDate: 'desc' }, take, skip }),
      this.prisma.tenant.finishedGood.count({ where }),
    ]);
    return { items, total, limit: take, offset: skip };
  }

  /**
   * Generates `count` sequential serials ("SN-000001" format, preserved
   * from the legacy system) for `companyId`, holding a transaction-scoped
   * advisory lock for the duration so two concurrent production-order
   * starts for the same company can never compute overlapping numbers.
   * Must be called from inside the caller's existing request transaction
   * (i.e. via `this.prisma.tenant`, never a fresh unscoped client).
   */
  async generateSerialNumbers(companyId: string, count: number): Promise<string[]> {
    if (count <= 0) return [];

    await this.prisma.tenant.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${companyId}))`;

    // No explicit companyId filter here — the tenant-scoping extension
    // already injects the current request's companyId into every
    // tenant-scoped query (prisma-tenant.extension.ts), and the `companyId`
    // parameter above is always that same tenant's id, so this counts
    // exactly this company's finished goods either way.
    const existingCount = await this.prisma.tenant.finishedGood.count();

    const serials: string[] = [];
    for (let i = 1; i <= count; i++) {
      serials.push(`SN-${String(existingCount + i).padStart(6, '0')}`);
    }
    return serials;
  }
}
