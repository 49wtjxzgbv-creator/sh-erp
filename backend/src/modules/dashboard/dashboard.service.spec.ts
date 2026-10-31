import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  let service: DashboardService;
  let prisma: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  beforeEach(() => {
    prisma = {
      tenant: {
        product: { count: jest.fn().mockResolvedValue(0) },
        assembly: { count: jest.fn().mockResolvedValue(0) },
        supplier: { count: jest.fn().mockResolvedValue(0) },
        purchaseOrder: { count: jest.fn().mockResolvedValue(0) },
        stockMovement: { count: jest.fn().mockResolvedValue(0) },
        customerOrder: { count: jest.fn().mockResolvedValue(0) },
        productionOrder: { count: jest.fn().mockResolvedValue(0) },
        finishedGood: { count: jest.fn().mockResolvedValue(0) },
        shipment: { count: jest.fn().mockResolvedValue(0) },
        employee: { count: jest.fn().mockResolvedValue(0) },
      },
    };
    service = new DashboardService(prisma);
  });

  describe('getOnboardingProgress', () => {
    it('reports every milestone false for a brand-new, empty company', async () => {
      const result = await service.getOnboardingProgress(user);
      expect(result).toEqual({
        hasProducts: false,
        hasAssemblies: false,
        hasSuppliers: false,
        hasPurchaseOrders: false,
        hasReceivedStock: false,
        hasCustomerOrders: false,
        hasProductionOrders: false,
        hasFinishedGoods: false,
        hasShipments: false,
        hasEmployees: false,
      });
    });

    it('flips a milestone true the moment its count is non-zero', async () => {
      prisma.tenant.customerOrder.count.mockResolvedValue(3);
      const result = await service.getOnboardingProgress(user);
      expect(result.hasCustomerOrders).toBe(true);
      expect(result.hasProducts).toBe(false);
    });

    it('scopes received-stock to RECEIVE movements only', async () => {
      await service.getOnboardingProgress(user);
      expect(prisma.tenant.stockMovement.count).toHaveBeenCalledWith({ where: { type: 'RECEIVE' } });
    });

    it('excludes soft-deleted rows for products, assemblies, and suppliers', async () => {
      await service.getOnboardingProgress(user);
      expect(prisma.tenant.product.count).toHaveBeenCalledWith({ where: { deletedAt: null } });
      expect(prisma.tenant.assembly.count).toHaveBeenCalledWith({ where: { deletedAt: null } });
      expect(prisma.tenant.supplier.count).toHaveBeenCalledWith({ where: { deletedAt: null } });
    });
  });
});
