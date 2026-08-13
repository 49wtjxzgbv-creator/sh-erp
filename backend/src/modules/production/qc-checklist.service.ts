import { Injectable } from '@nestjs/common';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { CodedNotFoundException } from '../../common/api-exceptions';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateQcChecklistItemDto } from './dto/qc-checklist-item.dto';

/** Configurable QC checklist item list (QualityControl.gs, Phase 1 §3.3). No defaults seeded at signup — same rationale as ProductionStagesService. */
@Injectable()
export class QcChecklistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(user: RequestUser, dto: CreateQcChecklistItemDto) {
    const maxSort = await this.prisma.tenant.qcChecklistItem.aggregate({ _max: { sortOrder: true } });
    const item = await this.prisma.tenant.qcChecklistItem.create({
      data: { name: dto.name, sortOrder: (maxSort._max.sortOrder ?? -1) + 1 } as any,
    });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'qc_checklist_item.created',
      entityType: 'QcChecklistItem',
      entityId: item.id,
      after: item,
    });
    return item;
  }

  async list(user: RequestUser) {
    return this.prisma.tenant.qcChecklistItem.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  /** Hard delete — QcCheckResult snapshots the item's name as text at check time, so it never breaks. */
  async remove(user: RequestUser, id: string) {
    const item = await this.prisma.tenant.qcChecklistItem.findUnique({ where: { id } });
    if (!item) throw new CodedNotFoundException('QC_CHECKLIST_ITEM_NOT_FOUND', 'QC checklist item not found.');
    await this.prisma.tenant.qcChecklistItem.delete({ where: { id } });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'qc_checklist_item.deleted',
      entityType: 'QcChecklistItem',
      entityId: id,
      before: item,
    });
    return { ok: true };
  }
}
