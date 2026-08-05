import { RolesService } from './roles.service';

describe('RolesService — custom-roles CRUD (production-readiness addition)', () => {
  let service: RolesService;
  let prisma: any;
  let audit: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'admin@b.com', roleId: 'r1' };

  beforeEach(() => {
    prisma = {
      permission: {
        findMany: jest.fn().mockResolvedValue([{ id: 'p1', key: 'products:read' }]),
      },
      tenant: {
        role: {
          findMany: jest.fn().mockResolvedValue([]),
          findUnique: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
          delete: jest.fn(),
        },
        rolePermission: {
          createMany: jest.fn(),
          deleteMany: jest.fn(),
        },
        companyMembership: {
          count: jest.fn().mockResolvedValue(0),
        },
      },
    };
    audit = { record: jest.fn() };
    service = new RolesService(prisma, audit);
  });

  it('create() rejects an unknown permission key rather than silently dropping it', async () => {
    prisma.tenant.role.findUnique.mockResolvedValue(null);
    await expect(
      service.create(user, { name: 'Custom', permissionKeys: ['nonexistent:key'] }),
    ).rejects.toThrow(/Unknown permission key/);
  });

  it('create() rejects a duplicate role name within the same company', async () => {
    prisma.tenant.role.findUnique.mockResolvedValue({ id: 'existing', name: 'Custom' });
    await expect(
      service.create(user, { name: 'Custom', permissionKeys: ['products:read'] }),
    ).rejects.toThrow();
  });

  it('create() grants the resolved permission ids', async () => {
    prisma.tenant.role.findUnique.mockResolvedValue(null);
    prisma.tenant.role.create.mockResolvedValue({
      id: 'role1',
      name: 'Custom',
      description: null,
      isSystem: false,
      permissions: [{ permission: { key: 'products:read' } }],
    });

    const result = await service.create(user, { name: 'Custom', permissionKeys: ['products:read'] });

    expect(result.permissionKeys).toEqual(['products:read']);
    expect(prisma.tenant.role.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isSystem: false }),
      }),
    );
  });

  it('remove() refuses to delete a system role', async () => {
    prisma.tenant.role.findUnique.mockResolvedValue({ id: 'role1', companyId: 'c1', isSystem: true, name: 'Admin' });
    await expect(service.remove(user, 'role1')).rejects.toThrow(/cannot be deleted/);
    expect(prisma.tenant.role.delete).not.toHaveBeenCalled();
  });

  it('remove() refuses to delete a role still assigned to a member', async () => {
    prisma.tenant.role.findUnique.mockResolvedValue({ id: 'role1', companyId: 'c1', isSystem: false, name: 'Custom' });
    prisma.tenant.companyMembership.count.mockResolvedValue(1);
    await expect(service.remove(user, 'role1')).rejects.toThrow(/still assigned/);
  });

  it('remove() deletes an unused, non-system role', async () => {
    prisma.tenant.role.findUnique.mockResolvedValue({ id: 'role1', companyId: 'c1', isSystem: false, name: 'Custom' });
    prisma.tenant.companyMembership.count.mockResolvedValue(0);
    prisma.tenant.role.delete.mockResolvedValue({ id: 'role1' });

    const result = await service.remove(user, 'role1');

    expect(result.deleted).toBe(true);
    expect(prisma.tenant.role.delete).toHaveBeenCalledWith({ where: { id: 'role1' } });
  });

  it("permissionsCatalogue() reads from the seeded Permission table, not the static constant, when rows exist", async () => {
    const result = await service.permissionsCatalogue();
    expect(result).toEqual([{ id: 'p1', key: 'products:read' }]);
  });
});
