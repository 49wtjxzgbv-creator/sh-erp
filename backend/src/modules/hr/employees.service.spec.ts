import { EmployeesService } from './employees.service';

describe('EmployeesService', () => {
  let service: EmployeesService;
  let prisma: any;
  let audit: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  beforeEach(() => {
    prisma = {
      tenant: {
        employee: {
          create: jest.fn(),
          findUnique: jest.fn(),
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
          update: jest.fn(),
        },
      },
    };
    audit = { record: jest.fn() };
    service = new EmployeesService(prisma, audit);
  });

  it('query() defaults to ACTIVE-only when no status filter is given', async () => {
    await service.query(user, {});
    expect(prisma.tenant.employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'ACTIVE' } }),
    );
  });

  it('query() honors an explicit status filter', async () => {
    await service.query(user, { status: 'INACTIVE' });
    expect(prisma.tenant.employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'INACTIVE' } }),
    );
  });

  it('deactivate() sets status to INACTIVE, never hard-deletes', async () => {
    prisma.tenant.employee.findUnique.mockResolvedValue({ id: 'e1', status: 'ACTIVE' });
    prisma.tenant.employee.update.mockResolvedValue({ id: 'e1', status: 'INACTIVE' });

    await service.deactivate(user, 'e1');

    expect(prisma.tenant.employee.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { status: 'INACTIVE' } });
  });

  it('reactivate() sets status back to ACTIVE', async () => {
    prisma.tenant.employee.findUnique.mockResolvedValue({ id: 'e1', status: 'INACTIVE' });
    prisma.tenant.employee.update.mockResolvedValue({ id: 'e1', status: 'ACTIVE' });

    await service.reactivate(user, 'e1');

    expect(prisma.tenant.employee.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { status: 'ACTIVE' } });
  });
});
