import { CustomersService } from './customers.service';

describe('CustomersService', () => {
  let service: CustomersService;
  let prisma: any;
  let audit: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  beforeEach(() => {
    prisma = {
      tenant: {
        customer: {
          create: jest.fn(),
          findUnique: jest.fn(),
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
          update: jest.fn(),
        },
      },
    };
    audit = { record: jest.fn() };
    service = new CustomersService(prisma, audit);
  });

  it('create persists the dto and audits creation', async () => {
    prisma.tenant.customer.create.mockResolvedValue({ id: 'cust1', name: 'ABC Ltd' });
    const result = await service.create(user, { name: 'ABC Ltd' } as any);
    expect(result).toEqual({ id: 'cust1', name: 'ABC Ltd' });
    expect(prisma.tenant.customer.create).toHaveBeenCalledWith({ data: { name: 'ABC Ltd' } });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'customer.created', entityType: 'Customer', entityId: 'cust1' }));
  });

  it('findOne throws NotFoundException for a missing customer', async () => {
    prisma.tenant.customer.findUnique.mockResolvedValue(null);
    await expect(service.findOne(user, 'missing')).rejects.toThrow();
  });

  it('query excludes soft-deleted rows by default and applies a case-insensitive name search', async () => {
    await service.query(user, { search: 'abc' } as any);
    expect(prisma.tenant.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null, name: { contains: 'abc', mode: 'insensitive' } } }),
    );
  });

  it('query includes soft-deleted rows when includeDeleted is set', async () => {
    await service.query(user, { includeDeleted: true } as any);
    expect(prisma.tenant.customer.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('remove soft-deletes (sets deletedAt) rather than hard-deleting', async () => {
    prisma.tenant.customer.findUnique.mockResolvedValue({ id: 'cust1', deletedAt: null });
    prisma.tenant.customer.update.mockResolvedValue({ id: 'cust1', deletedAt: new Date() });
    await service.remove(user, 'cust1');
    expect(prisma.tenant.customer.update).toHaveBeenCalledWith({ where: { id: 'cust1' }, data: { deletedAt: expect.any(Date) } });
  });

  it('remove rejects an already-deleted customer with a conflict, not a silent no-op', async () => {
    prisma.tenant.customer.findUnique.mockResolvedValue({ id: 'cust1', deletedAt: new Date() });
    await expect(service.remove(user, 'cust1')).rejects.toThrow();
    expect(prisma.tenant.customer.update).not.toHaveBeenCalled();
  });
});
