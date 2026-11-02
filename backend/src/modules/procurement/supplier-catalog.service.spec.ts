import { SupplierCatalogService } from './supplier-catalog.service';

describe('SupplierCatalogService', () => {
  let service: SupplierCatalogService;
  let prisma: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  const activeConnection = {
    status: 'ACTIVE',
    supplierOrganization: { portalUser: { active: true } },
  };

  beforeEach(() => {
    prisma = {
      tenant: {
        supplierConnection: { findUnique: jest.fn() },
        productSupplier: { upsert: jest.fn() },
      },
    };
    service = new SupplierCatalogService(prisma);
  });

  it('does nothing when supplierId is missing', async () => {
    await service.ensureCatalogEntries(user, null, ['p1']);
    expect(prisma.tenant.supplierConnection.findUnique).not.toHaveBeenCalled();
  });

  it('does nothing when productIds is empty or all null', async () => {
    await service.ensureCatalogEntries(user, 's1', []);
    await service.ensureCatalogEntries(user, 's1', [null, undefined]);
    expect(prisma.tenant.supplierConnection.findUnique).not.toHaveBeenCalled();
  });

  it('does nothing when there is no connection at all', async () => {
    prisma.tenant.supplierConnection.findUnique.mockResolvedValue(null);
    await service.ensureCatalogEntries(user, 's1', ['p1']);
    expect(prisma.tenant.productSupplier.upsert).not.toHaveBeenCalled();
  });

  it('does nothing when the connection is PENDING', async () => {
    prisma.tenant.supplierConnection.findUnique.mockResolvedValue({ ...activeConnection, status: 'PENDING' });
    await service.ensureCatalogEntries(user, 's1', ['p1']);
    expect(prisma.tenant.productSupplier.upsert).not.toHaveBeenCalled();
  });

  it('does nothing when the portal account itself is deactivated', async () => {
    prisma.tenant.supplierConnection.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      supplierOrganization: { portalUser: { active: false } },
    });
    await service.ensureCatalogEntries(user, 's1', ['p1']);
    expect(prisma.tenant.productSupplier.upsert).not.toHaveBeenCalled();
  });

  it('upserts one row per distinct productId when ACTIVE, ensure-exists only (never overwrites an existing row)', async () => {
    prisma.tenant.supplierConnection.findUnique.mockResolvedValue(activeConnection);

    await service.ensureCatalogEntries(user, 's1', ['p1', 'p2', 'p1', null]);

    expect(prisma.tenant.productSupplier.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.tenant.productSupplier.upsert).toHaveBeenCalledWith({
      where: { productId_supplierId: { productId: 'p1', supplierId: 's1' } },
      create: { companyId: 'c1', productId: 'p1', supplierId: 's1' },
      update: {},
    });
    expect(prisma.tenant.productSupplier.upsert).toHaveBeenCalledWith({
      where: { productId_supplierId: { productId: 'p2', supplierId: 's1' } },
      create: { companyId: 'c1', productId: 'p2', supplierId: 's1' },
      update: {},
    });
  });

  it('never throws — swallows an upsert failure and just logs', async () => {
    prisma.tenant.supplierConnection.findUnique.mockResolvedValue(activeConnection);
    prisma.tenant.productSupplier.upsert.mockRejectedValue(new Error('db hiccup'));

    await expect(service.ensureCatalogEntries(user, 's1', ['p1'])).resolves.toBeUndefined();
  });
});
