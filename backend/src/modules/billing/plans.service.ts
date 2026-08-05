import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * `Plan` (Phase 0 billing stub) — a genuinely global, non-tenant-scoped
 * table (seeded once via `prisma/seed.ts`, not per company), so this reads
 * through the raw `this.prisma` client rather than `this.prisma.tenant`,
 * same rationale as `RolesService.seedDefaultRoles` reading `Permission`
 * that way.
 */
@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    return this.prisma.plan.findMany({ orderBy: { monthlyPriceEur: 'asc' } });
  }

  async findByKey(key: string) {
    return this.prisma.plan.findUnique({ where: { key } });
  }
}
