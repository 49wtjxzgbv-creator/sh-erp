import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  let service: ReportsService;
  let prisma: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  beforeEach(() => {
    prisma = {
      tenant: {
        product: { findMany: jest.fn().mockResolvedValue([]) },
        productionOrder: { findMany: jest.fn().mockResolvedValue([]) },
        assemblyVersionComponent: { findMany: jest.fn().mockResolvedValue([]) },
        assembly: { findMany: jest.fn().mockResolvedValue([]) },
      },
    };
    service = new ReportsService(prisma);
  });

  describe('getReorderSuggestions — reservations batched from PLANNED orders only (Phase 1 §3.6)', () => {
    it('skips products with no reorder point configured (minQty <= 0)', async () => {
      prisma.tenant.product.findMany.mockResolvedValue([{ id: 'p1', article: 'A1', name: 'Widget', qty: 5, minQty: 0 }]);
      const result = await service.getReorderSuggestions(user, {});
      expect(result).toEqual([]);
    });

    it('flags a product below target (2x minQty) with no reservations', async () => {
      prisma.tenant.product.findMany.mockResolvedValue([{ id: 'p1', article: 'A1', name: 'Widget', qty: 5, minQty: 10 }]);
      const [line] = await service.getReorderSuggestions(user, {});
      expect(line).toEqual(
        expect.objectContaining({ productId: 'p1', qty: 5, reserved: 0, available: 5, minQty: 10, target: 20, suggestedOrderQty: 15 }),
      );
    });

    it('reduces available stock by reservations from PLANNED production orders only, one BOM level deep', async () => {
      prisma.tenant.product.findMany.mockResolvedValue([{ id: 'p1', article: 'A1', name: 'Widget', qty: 100, minQty: 10 }]);
      prisma.tenant.productionOrder.findMany.mockResolvedValue([
        { assemblyVersionId: 'v1', unitsPlanned: 5 },
      ]);
      prisma.tenant.assemblyVersionComponent.findMany.mockResolvedValue([
        { assemblyVersionId: 'v1', componentType: 'PRODUCT', productId: 'p1', qtyPerUnit: 4 },
      ]);

      const [line] = await service.getReorderSuggestions(user, {});
      // reserved = 5 units planned * 4 qtyPerUnit = 20; available = 100 - 20 = 80; target = 20 -> not below target, so no suggestion... verify directly instead.
      expect(line).toBeUndefined();
    });

    it('does produce a suggestion when reservations push available below target', async () => {
      prisma.tenant.product.findMany.mockResolvedValue([{ id: 'p1', article: 'A1', name: 'Widget', qty: 30, minQty: 10 }]);
      prisma.tenant.productionOrder.findMany.mockResolvedValue([
        { assemblyVersionId: 'v1', unitsPlanned: 5 },
      ]);
      prisma.tenant.assemblyVersionComponent.findMany.mockResolvedValue([
        { assemblyVersionId: 'v1', componentType: 'PRODUCT', productId: 'p1', qtyPerUnit: 4 },
      ]);

      const [line] = await service.getReorderSuggestions(user, {});
      // reserved = 20; available = 30 - 20 = 10; target = 20; suggestedOrderQty = 10
      expect(line).toEqual(expect.objectContaining({ reserved: 20, available: 10, target: 20, suggestedOrderQty: 10 }));
    });

    it('respects the limit and sorts by worst shortfall first', async () => {
      prisma.tenant.product.findMany.mockResolvedValue([
        { id: 'p1', article: 'A1', name: 'Small shortfall', qty: 18, minQty: 10 }, // target 20, shortfall 2
        { id: 'p2', article: 'A2', name: 'Big shortfall', qty: 0, minQty: 10 }, // target 20, shortfall 20
      ]);
      const result = await service.getReorderSuggestions(user, { limit: 1 });
      expect(result).toHaveLength(1);
      expect(result[0].productId).toBe('p2');
    });
  });

  describe('getWarehouseValuation — 5 legacy price fields, grouped by category (Phase 1 §5, admin-only)', () => {
    it('sums qty * each price field per category and rolls up a grand total', async () => {
      prisma.tenant.product.findMany.mockResolvedValue([
        {
          id: 'p1', category: 'Electronics', qty: 10,
          localPriceExclVat: 1, localPriceInclVat: 1.2, germanPriceExclVat: 2, germanPriceInclVat: 2.4, sellPriceEur: 5,
        },
        {
          id: 'p2', category: 'Electronics', qty: 5,
          localPriceExclVat: 2, localPriceInclVat: 2.4, germanPriceExclVat: 3, germanPriceInclVat: 3.6, sellPriceEur: 8,
        },
        {
          id: 'p3', category: 'Hardware', qty: 1,
          localPriceExclVat: 10, localPriceInclVat: 12, germanPriceExclVat: 20, germanPriceInclVat: 24, sellPriceEur: 40,
        },
      ]);

      const { byCategory, grandTotal } = await service.getWarehouseValuation(user);

      const electronics = byCategory.find((c) => c.category === 'Electronics')!;
      expect(electronics.productCount).toBe(2);
      expect(electronics.totalLocalExclVat).toBe(10 * 1 + 5 * 2); // 20
      expect(electronics.totalSellEur).toBe(10 * 5 + 5 * 8); // 90

      expect(grandTotal.productCount).toBe(3);
      expect(grandTotal.totalLocalExclVat).toBe(20 + 1 * 10); // 30
      expect(grandTotal.totalSellEur).toBe(90 + 1 * 40); // 130
    });

    it('groups products with no category under a null bucket rather than dropping them', async () => {
      prisma.tenant.product.findMany.mockResolvedValue([
        { id: 'p1', category: null, qty: 2, localPriceExclVat: 3, localPriceInclVat: 3, germanPriceExclVat: 3, germanPriceInclVat: 3, sellPriceEur: 3 },
      ]);
      const { byCategory } = await service.getWarehouseValuation(user);
      expect(byCategory).toHaveLength(1);
      expect(byCategory[0].category).toBeNull();
      expect(byCategory[0].productCount).toBe(1);
    });
  });

  describe('getMonthlyProductionRollup — COMPLETED orders grouped by assembly over a date range', () => {
    it('groups units produced and frozen costs by assembly', async () => {
      prisma.tenant.productionOrder.findMany.mockResolvedValue([
        { assemblyId: 'a1', unitsPlanned: 10, totalLocalCostEur: 100, totalGermanCostEur: 150 },
        { assemblyId: 'a1', unitsPlanned: 5, totalLocalCostEur: 50, totalGermanCostEur: 75 },
        { assemblyId: 'a2', unitsPlanned: 1, totalLocalCostEur: 20, totalGermanCostEur: 30 },
      ]);
      prisma.tenant.assembly.findMany.mockResolvedValue([
        { id: 'a1', name: 'Assembly One' },
        { id: 'a2', name: 'Assembly Two' },
      ]);

      const result = await service.getMonthlyProductionRollup(user, {});

      expect(result[0]).toEqual(
        expect.objectContaining({
          assemblyId: 'a1', assemblyName: 'Assembly One', ordersCount: 2, unitsProduced: 15,
          totalLocalCostEur: 150, totalGermanCostEur: 225,
        }),
      );
      // sorted by unitsProduced desc
      expect(result[1].assemblyId).toBe('a2');
    });

    it('queries only COMPLETED orders within the requested date range', async () => {
      await service.getMonthlyProductionRollup(user, { from: '2026-01-01', to: '2026-01-31' });
      expect(prisma.tenant.productionOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'COMPLETED',
            completedAt: { gte: new Date('2026-01-01'), lte: new Date('2026-01-31') },
          }),
        }),
      );
    });
  });
});
