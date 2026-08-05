import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: any;
  let audit: any;
  let email: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'admin@b.com', roleId: 'r1' };

  beforeEach(() => {
    prisma = {
      tenant: {
        companyMembership: {
          findMany: jest.fn().mockResolvedValue([]),
          findUnique: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
          delete: jest.fn(),
          count: jest.fn().mockResolvedValue(2),
        },
        user: {
          findMany: jest.fn().mockResolvedValue([]),
          findUnique: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
        },
        role: {
          findMany: jest.fn().mockResolvedValue([]),
          findUnique: jest.fn(),
        },
      },
    };
    audit = { record: jest.fn() };
    email = { send: jest.fn().mockResolvedValue({ sent: true }) };
    service = new UsersService(prisma, audit, email);
  });

  it('invite() creates a new account with a temp password for a brand-new email', async () => {
    prisma.tenant.role.findUnique.mockResolvedValue({ id: 'role1', name: 'Storekeeper' });
    prisma.tenant.user.findUnique.mockResolvedValue(null);
    prisma.tenant.user.create.mockResolvedValue({ id: 'newUser1', email: 'x@y.com', fullName: 'X Y' });
    prisma.tenant.companyMembership.create.mockResolvedValue({ id: 'm1' });

    const result = await service.invite(user, { email: 'x@y.com', fullName: 'X Y', roleId: 'role1' });

    expect(result.tempPassword).not.toBeNull();
    expect(prisma.tenant.user.create).toHaveBeenCalled();
    expect(email.send).toHaveBeenCalled();
  });

  it('invite() attaches an existing user without touching their password', async () => {
    prisma.tenant.role.findUnique.mockResolvedValue({ id: 'role1', name: 'Storekeeper' });
    prisma.tenant.user.findUnique.mockResolvedValue({ id: 'existing1', email: 'x@y.com', fullName: 'X Y' });
    prisma.tenant.companyMembership.findUnique.mockResolvedValue(null); // no existing membership yet
    prisma.tenant.companyMembership.create.mockResolvedValue({ id: 'm1' });

    const result = await service.invite(user, { email: 'x@y.com', fullName: 'X Y', roleId: 'role1' });

    expect(result.tempPassword).toBeNull();
    expect(prisma.tenant.user.create).not.toHaveBeenCalled();
  });

  it('invite() rejects if the person already has a membership in this company', async () => {
    prisma.tenant.role.findUnique.mockResolvedValue({ id: 'role1' });
    prisma.tenant.user.findUnique.mockResolvedValue({ id: 'existing1', email: 'x@y.com' });
    prisma.tenant.companyMembership.findUnique.mockResolvedValue({ id: 'm-existing' });

    await expect(service.invite(user, { email: 'x@y.com', fullName: 'X Y', roleId: 'role1' })).rejects.toThrow();
  });

  it('deactivate() refuses to remove your own access', async () => {
    await expect(service.deactivate(user, user.userId)).rejects.toThrow();
    expect(prisma.tenant.companyMembership.delete).not.toHaveBeenCalled();
  });

  it('deactivate() refuses to remove the last remaining member', async () => {
    prisma.tenant.companyMembership.findUnique.mockResolvedValue({ id: 'm2', roleId: 'role1' });
    prisma.tenant.companyMembership.count.mockResolvedValue(1);

    await expect(service.deactivate(user, 'otherUser')).rejects.toThrow();
    expect(prisma.tenant.companyMembership.delete).not.toHaveBeenCalled();
  });

  it('deactivate() removes the CompanyMembership, not the global User row', async () => {
    prisma.tenant.companyMembership.findUnique.mockResolvedValue({ id: 'm2', roleId: 'role1' });
    prisma.tenant.companyMembership.count.mockResolvedValue(2);
    prisma.tenant.companyMembership.delete.mockResolvedValue({ id: 'm2' });

    await service.deactivate(user, 'otherUser');

    expect(prisma.tenant.companyMembership.delete).toHaveBeenCalledWith({ where: { id: 'm2' } });
  });
});
