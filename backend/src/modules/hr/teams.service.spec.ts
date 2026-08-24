import { NotFoundException } from '@nestjs/common';
import { TeamsService } from './teams.service';

describe('TeamsService', () => {
  let service: TeamsService;
  let prisma: any;
  let audit: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  const team = { id: 't1', name: 'Alpha', members: [] };

  beforeEach(() => {
    prisma = {
      tenant: {
        team: { create: jest.fn(), findUnique: jest.fn().mockResolvedValue(team), findMany: jest.fn(), count: jest.fn(), update: jest.fn(), delete: jest.fn() },
        teamMember: { deleteMany: jest.fn(), createMany: jest.fn() },
      },
    };
    audit = { record: jest.fn() };
    service = new TeamsService(prisma, audit);
  });

  it('findOne throws a coded not-found for a missing team', async () => {
    prisma.tenant.team.findUnique.mockResolvedValue(null);
    await expect(service.findOne(user, 'nope')).rejects.toThrow(NotFoundException);
  });

  describe('setMembers', () => {
    it('full-replaces the roster: deletes all existing members, then creates the new unique set', async () => {
      await service.setMembers(user, 't1', { employeeIds: ['e1', 'e2', 'e1'] });
      expect(prisma.tenant.teamMember.deleteMany).toHaveBeenCalledWith({ where: { teamId: 't1' } });
      expect(prisma.tenant.teamMember.createMany).toHaveBeenCalledWith({
        data: [{ teamId: 't1', employeeId: 'e1' }, { teamId: 't1', employeeId: 'e2' }],
      });
    });

    it('an empty roster just clears members, without a createMany call', async () => {
      await service.setMembers(user, 't1', { employeeIds: [] });
      expect(prisma.tenant.teamMember.deleteMany).toHaveBeenCalled();
      expect(prisma.tenant.teamMember.createMany).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes the team outright — ProductionExecution.teamId is a SetNull reporting tag, no dependents to guard', async () => {
      await service.remove(user, 't1');
      expect(prisma.tenant.team.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
    });
  });
});
