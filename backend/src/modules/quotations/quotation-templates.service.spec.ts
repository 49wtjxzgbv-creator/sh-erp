import { QuotationTemplatesService } from './quotation-templates.service';

describe('QuotationTemplatesService', () => {
  let service: QuotationTemplatesService;
  let prisma: any;
  let audit: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  beforeEach(() => {
    prisma = {
      tenant: {
        quotationTemplate: {
          create: jest.fn(),
          findUnique: jest.fn(),
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([]),
          update: jest.fn(),
        },
      },
    };
    audit = { record: jest.fn() };
    service = new QuotationTemplatesService(prisma, audit);
  });

  it('create persists the dto and audits creation', async () => {
    prisma.tenant.quotationTemplate.create.mockResolvedValue({ id: 't1', name: 'Standard' });
    const result = await service.create(user, { name: 'Standard' } as any);
    expect(result).toEqual({ id: 't1', name: 'Standard' });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'quotation_template.created', entityType: 'QuotationTemplate', entityId: 't1' }));
  });

  it('creating with isDefault=true clears any previous default first', async () => {
    prisma.tenant.quotationTemplate.findFirst.mockResolvedValue({ id: 't-old', isDefault: true });
    prisma.tenant.quotationTemplate.create.mockResolvedValue({ id: 't-new', name: 'New default', isDefault: true });
    await service.create(user, { name: 'New default', isDefault: true } as any);
    expect(prisma.tenant.quotationTemplate.update).toHaveBeenCalledWith({ where: { id: 't-old' }, data: { isDefault: false } });
  });

  it('findOne throws NotFoundException for a missing or soft-deleted template', async () => {
    prisma.tenant.quotationTemplate.findUnique.mockResolvedValue(null);
    await expect(service.findOne(user, 'missing')).rejects.toThrow();
    prisma.tenant.quotationTemplate.findUnique.mockResolvedValue({ id: 't1', deletedAt: new Date() });
    await expect(service.findOne(user, 't1')).rejects.toThrow();
  });

  it('remove soft-deletes rather than hard-deleting, and rejects an already-deleted template', async () => {
    prisma.tenant.quotationTemplate.findUnique.mockResolvedValue({ id: 't1', deletedAt: null });
    prisma.tenant.quotationTemplate.update.mockResolvedValue({ id: 't1', deletedAt: new Date() });
    await service.remove(user, 't1');
    expect(prisma.tenant.quotationTemplate.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { deletedAt: expect.any(Date) } });

    prisma.tenant.quotationTemplate.findUnique.mockResolvedValue({ id: 't1', deletedAt: new Date() });
    await expect(service.remove(user, 't1')).rejects.toThrow();
  });
});
