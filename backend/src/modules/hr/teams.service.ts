import { Injectable } from '@nestjs/common';
import { CodedNotFoundException } from '../../common/api-exceptions';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateTeamDto, QueryTeamsDto, SetTeamMembersDto, UpdateTeamDto } from './dto/team.dto';

/**
 * Team = a preset of worker composition (locked spec #11) — a brigade
 * label to speed up filling in a ProductionExecution's allocations. It is
 * NEVER a payroll unit itself: the actual executor is always recorded via
 * ProductionExecutionAllocation.employeeId, and ProductionExecution.teamId
 * is a reporting tag only. Changing a team's roster here therefore never
 * touches any existing execution's own already-recorded allocations.
 */
@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(user: RequestUser, dto: CreateTeamDto) {
    const team = await this.prisma.tenant.team.create({ data: { name: dto.name } as any });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'team.created',
      entityType: 'Team',
      entityId: team.id,
      after: team,
    });
    return team;
  }

  async query(user: RequestUser, query: QueryTeamsDto) {
    const take = query.limit ?? 50;
    const skip = query.offset ?? 0;
    const [items, total] = await Promise.all([
      this.prisma.tenant.team.findMany({
        include: { members: { include: { employee: true } } },
        orderBy: { name: 'asc' },
        take,
        skip,
      }),
      this.prisma.tenant.team.count(),
    ]);
    return { items, total, limit: take, offset: skip };
  }

  async findOne(user: RequestUser, id: string) {
    const team = await this.prisma.tenant.team.findUnique({ where: { id }, include: { members: { include: { employee: true } } } });
    if (!team) throw new CodedNotFoundException('TEAM_NOT_FOUND', 'Team not found.');
    return team;
  }

  async update(user: RequestUser, id: string, dto: UpdateTeamDto) {
    const before = await this.findOne(user, id);
    const team = await this.prisma.tenant.team.update({ where: { id }, data: { name: dto.name } });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'team.updated',
      entityType: 'Team',
      entityId: id,
      before,
      after: team,
    });
    return team;
  }

  async setMembers(user: RequestUser, id: string, dto: SetTeamMembersDto) {
    const before = await this.findOne(user, id);
    const uniqueIds = Array.from(new Set(dto.employeeIds));
    await this.prisma.tenant.teamMember.deleteMany({ where: { teamId: id } });
    if (uniqueIds.length > 0) {
      await this.prisma.tenant.teamMember.createMany({
        data: uniqueIds.map((employeeId) => ({ teamId: id, employeeId })) as any,
      });
    }
    const after = await this.findOne(user, id);
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'team.members_set',
      entityType: 'Team',
      entityId: id,
      before,
      after,
    });
    return after;
  }

  /** No dependents to guard — ProductionExecution.teamId is a SetNull reporting tag (schema.prisma), so deleting a team never blocks or corrupts execution history. */
  async remove(user: RequestUser, id: string) {
    const before = await this.findOne(user, id);
    await this.prisma.tenant.team.delete({ where: { id } });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'team.deleted',
      entityType: 'Team',
      entityId: id,
      before,
    });
  }
}
