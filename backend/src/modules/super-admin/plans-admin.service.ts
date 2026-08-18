import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SuperAdminPrismaService } from './super-admin-prisma.service';
import { SuperAdminAuditService } from './super-admin-audit.service';
import { RequestSuperAdmin } from './super-admin-context';
import { UpsertPlanDto } from './dto/upsert-plan.dto';
import { CodedConflictException, CodedNotFoundException } from '../../common/api-exceptions';

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

  async delete(actor: RequestSuperAdmin, planId: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) throw new CodedNotFoundException('PLAN_NOT_FOUND', 'Plan not found.');

    try {
      await this.prisma.plan.delete({ where: { id: planId } });
    } catch (err) {
      // CompanySubscription.plan has no onDelete override (Restrict by
      // default) — deliberately: silently cascading would leave a company
      // with no plan at all. Surface it as a clear, actionable error
      // instead of a raw 500.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new CodedConflictException('PLAN_IN_USE', 'Cannot delete a plan that companies are still subscribed to.');
      }
      throw err;
    }

    await this.superAdminAudit.record({
      superAdminId: actor.superAdminId,
      action: 'plan.deleted',
      targetType: 'Plan',
      targetId: planId,
      metadata: { key: plan.key },
    });
    return { deleted: true };
  }
}
