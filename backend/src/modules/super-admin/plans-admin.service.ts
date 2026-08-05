import { Injectable } from '@nestjs/common';
import { SuperAdminPrismaService } from './super-admin-prisma.service';
import { SuperAdminAuditService } from './super-admin-audit.service';
import { RequestSuperAdmin } from './super-admin-context';
import { UpsertPlanDto } from './dto/upsert-plan.dto';

/**
 * "Керувати тарифами" — Plan rows were previously seed-only (prisma/seed.ts)
 * with no endpoint to create or edit one; this is the first place a plan
 * can actually be managed after initial seeding, a real gap closed during
 * this audit rather than left as "edit the seed file and re-run it."
 */
@Injectable()
export class PlansAdminService {
  constructor(
    private readonly prisma: SuperAdminPrismaService,
    private readonly superAdminAudit: SuperAdminAuditService,
  ) {}

  async list() {
    return this.prisma.plan.findMany({ orderBy: { monthlyPriceEur: 'asc' } });
  }

  async upsert(actor: RequestSuperAdmin, dto: UpsertPlanDto) {
    const plan = await this.prisma.plan.upsert({
      where: { key: dto.key },
      update: { name: dto.name, monthlyPriceEur: dto.monthlyPriceEur, limits: dto.limits as any },
      create: { key: dto.key, name: dto.name, monthlyPriceEur: dto.monthlyPriceEur, limits: dto.limits as any },
    });
    await this.superAdminAudit.record({
      superAdminId: actor.superAdminId,
      action: 'plan.upserted',
      targetType: 'Plan',
      targetId: plan.id,
      metadata: { key: plan.key, monthlyPriceEur: dto.monthlyPriceEur },
    });
    return plan;
  }
}
