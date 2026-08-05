import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';

const DEFAULT_PLAN_KEY = 'starter';

/**
 * `CompanySubscription` (Phase 0 billing stub — "architecture ready, Stripe
 * integration not implemented yet"; Phase 2 §11.5: "plan assignment (stub
 * until BillingModule is real)"). `updatePlan` is deliberately NOT a real
 * checkout flow — no payment is collected, no Stripe webhook exists yet, it
 * just records which plan the company is on. Wiring up real billing is
 * future work; this makes the data model and the switch-plan action already
 * work end to end so the frontend has something real to build against.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Called once, from `CompanyService.createCompany`, inside that same
   * signup transaction — every new company starts on the free `starter`
   * plan, `TRIALING` (the schema's own default). Mirrors the
   * `seedDefaultRoles(tx, ...)` / `seedDefaults(tx, ...)` naming convention
   * every other per-company seeder in this codebase already follows.
   */
  async seedDefaultSubscription(tx: Prisma.TransactionClient, companyId: string): Promise<void> {
    const plan = await tx.plan.findUnique({ where: { key: DEFAULT_PLAN_KEY } });
    if (!plan) {
      throw new BadRequestException(
        `Default plan "${DEFAULT_PLAN_KEY}" not found — run \`prisma db seed\` before allowing signups.`,
      );
    }
    await tx.companySubscription.create({
      data: { companyId, planId: plan.id },
    });
  }

  async getSubscription(user: RequestUser) {
    const subscription = await this.prisma.tenant.companySubscription.findUnique({
      where: { companyId: user.companyId },
    });
    if (!subscription) throw new NotFoundException('No subscription on record for this company.');

    const plan = await this.prisma.plan.findUnique({ where: { id: subscription.planId } });
    return { ...subscription, plan };
  }

  async updatePlan(user: RequestUser, dto: UpdateSubscriptionDto) {
    const plan = await this.prisma.plan.findUnique({ where: { key: dto.planKey } });
    if (!plan) throw new NotFoundException(`Unknown plan: ${dto.planKey}`);

    const before = await this.prisma.tenant.companySubscription.findUnique({ where: { companyId: user.companyId } });
    const updated = await this.prisma.tenant.companySubscription.update({
      where: { companyId: user.companyId },
      data: { planId: plan.id },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'company_subscription.plan_changed',
      entityType: 'CompanySubscription',
      entityId: user.companyId,
      before,
      after: updated,
    });

    return { ...updated, plan };
  }
}
