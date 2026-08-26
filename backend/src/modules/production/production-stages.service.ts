import { Injectable } from '@nestjs/common';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { CodedConflictException, CodedNotFoundException } from '../../common/api-exceptions';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateProductionStageDto, ReorderProductionStagesDto } from './dto/production-stage.dto';

/**
 * Configurable production-stage list (ProductionStages.gs, Phase 1 §3.3).
 * No defaults are seeded at company signup — unlike CompanyUnit/Warehouse,
 * the legacy system has no fixed default stage list; a company that wants
 * stage tracking configures it explicitly, and `ProductionOrder.start()`
 * (production-orders.service.ts) falls back to completing immediately if
 * none are configured, matching Phase 1 §3.3's "(if configured) enters the
 * multi-stage progress tracker."
 */
@Injectable()
export class ProductionStagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(user: RequestUser, dto: CreateProductionStageDto) {
    const maxSort = await this.prisma.tenant.productionStage.aggregate({ _max: { sortOrder: true } });
    const stage = await this.prisma.tenant.productionStage.create({
      data: { name: dto.name, sortOrder: (maxSort._max.sortOrder ?? -1) + 1 } as any,
    });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'production_stage.created',
      entityType: 'ProductionStage',
      entityId: stage.id,
      after: stage,
    });
    return stage;
  }

  async list(user: RequestUser) {
    return this.prisma.tenant.productionStage.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  /** Rewrites sortOrder for every stage to match the given id order. */
  async reorder(user: RequestUser, dto: ReorderProductionStagesDto) {
    const existing = await this.list(user);
    const existingIds = new Set(existing.map((s) => s.id));
    if (dto.orderedIds.length !== existing.length || !dto.orderedIds.every((id) => existingIds.has(id))) {
      throw new CodedConflictException('PRODUCTION_STAGE_REORDER_MISMATCH', 'orderedIds must contain exactly every existing stage id, once each.');
    }

    for (let i = 0; i < dto.orderedIds.length; i++) {
      await this.prisma.tenant.productionStage.update({
        where: { id: dto.orderedIds[i] },
        data: { sortOrder: i },
      });
    }

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'production_stage.reordered',
      entityType: 'ProductionStage',
      entityId: user.companyId,
      after: { orderedIds: dto.orderedIds },
    });

    return this.list(user);
  }

  /**
   * Hard delete. Historical progress (ProductionOrderStageEvent) stores a
   * plain `stageIndex` integer snapshot, not a relation, precisely so a
   * later stage-list edit never corrupts historical events — that part of
   * the original claim holds. But ProductionOrderStagePlan (the
   * План-графік/Planner schedule, added after this comment was first
   * written) DOES hold a real FK to the stage with the Prisma default
   * (`onDelete: Restrict`), so any stage assigned to an order's schedule
   * used to fail deletion with a raw, untranslated Postgres FK-violation
   * 500. ProductionOrderStagePlan only carries planned dates + sort order
   * (no financial/audit data — that's the decoupled stage-index snapshot
   * above), so it's safe to drop those planning rows here: deleting a
   * stage from the catalog just removes it from any order's schedule.
   * Renumbers remaining stages so sortOrder stays contiguous.
   */
  async remove(user: RequestUser, id: string) {
    const stage = await this.prisma.tenant.productionStage.findUnique({ where: { id } });
    if (!stage) throw new CodedNotFoundException('PRODUCTION_STAGE_NOT_FOUND', 'Production stage not found.');

    await this.prisma.tenant.productionOrderStagePlan.deleteMany({ where: { productionStageId: id } });
    await this.prisma.tenant.productionStage.delete({ where: { id } });

    const remaining = await this.prisma.tenant.productionStage.findMany({ orderBy: { sortOrder: 'asc' } });
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].sortOrder !== i) {
        await this.prisma.tenant.productionStage.update({ where: { id: remaining[i].id }, data: { sortOrder: i } });
      }
    }

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'production_stage.deleted',
      entityType: 'ProductionStage',
      entityId: id,
      before: stage,
    });
    return { ok: true };
  }
}
