import { Injectable, NotFoundException } from '@nestjs/common';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RecordQcCheckDto } from './dto/qc-check.dto';

/**
 * Checklist-based inspection tied to a specific FinishedGood unit
 * (QualityControl.gs, Phase 1 §3.3). A check result flips that unit's
 * status between IN_STOCK (accepted) and REWORK — the one piece of
 * business logic this module exists to preserve; everything else is
 * straightforward CRUD over the check + its per-item result snapshot.
 */
@Injectable()
export class QcService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async recordCheck(user: RequestUser, dto: RecordQcCheckDto) {
    const finishedGood = await this.prisma.tenant.finishedGood.findUnique({ where: { id: dto.finishedGoodId } });
    if (!finishedGood) throw new NotFoundException('Finished good not found.');

    const check = await this.prisma.tenant.qcCheck.create({
      data: {
        finishedGoodId: dto.finishedGoodId,
        result: dto.result,
        inspectorId: user.userId,
        comment: dto.comment,
      } as any,
    });

    if (dto.results && dto.results.length > 0) {
      await this.prisma.tenant.qcCheckResult.createMany({
        data: dto.results.map((line) => ({
          qcCheckId: check.id,
          itemName: line.itemName,
          passed: line.passed,
        })) as any,
      });
    }

    const updatedGood = await this.prisma.tenant.finishedGood.update({
      where: { id: dto.finishedGoodId },
      data: { status: dto.result === 'ACCEPTED' ? 'IN_STOCK' : 'REWORK' },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'qc_check.recorded',
      entityType: 'QcCheck',
      entityId: check.id,
      after: { check, finishedGoodStatus: updatedGood.status },
    });

    return { check, finishedGood: updatedGood };
  }

  async findForFinishedGood(user: RequestUser, finishedGoodId: string) {
    return this.prisma.tenant.qcCheck.findMany({
      where: { finishedGoodId },
      include: { results: true },
      orderBy: { checkedAt: 'desc' },
    });
  }
}
