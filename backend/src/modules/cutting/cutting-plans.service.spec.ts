import { CuttingPlansService } from './cutting-plans.service';

describe('CuttingPlansService', () => {
  let service: CuttingPlansService;
  let prisma: any;
  let audit: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  beforeEach(() => {
    prisma = {
      tenant: {
        assembly: { findUnique: jest.fn() },
        assemblyComponent: { findMany: jest.fn().mockResolvedValue([]) },
        productCuttingSpec: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
        stockRemnant: {
          findMany: jest.fn().mockResolvedValue([]),
          update: jest.fn(),
          create: jest.fn().mockResolvedValue({ id: 'new-remnant-1' }),
          count: jest.fn().mockResolvedValue(0),
        },
        cuttingPlan: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
        cuttingPlanStock: { create: jest.fn(), update: jest.fn() },
        cuttingPlanCut: { createMany: jest.fn() },
        product: { findMany: jest.fn().mockResolvedValue([]) },
        warehouse: { findFirst: jest.fn().mockResolvedValue({ id: 'w1' }) },
        $executeRaw: jest.fn(),
      },
    };
    audit = { record: jest.fn() };
    service = new CuttingPlansService(prisma, audit);
  });

  describe('preview', () => {
    it('throws when the assembly does not exist', async () => {
      prisma.tenant.assembly.findUnique.mockResolvedValue(null);

      await expect(service.preview(user, { assemblyId: 'missing', qty: 1 })).rejects.toThrow();
    });

    it('throws when the BOM has no components with a cut length set', async () => {
      prisma.tenant.assembly.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.tenant.assemblyComponent.findMany.mockResolvedValue([{ componentType: 'PRODUCT', productId: 'p1', qtyPerUnit: 2, cutLengthCm: null }]);

      await expect(service.preview(user, { assemblyId: 'a1', qty: 1 })).rejects.toThrow();
    });

    it('flattens a BAR component, runs the optimizer, and persists a DRAFT plan with its stock/cut rows', async () => {
      prisma.tenant.assembly.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.tenant.assemblyComponent.findMany.mockResolvedValue([
        { componentType: 'PRODUCT', productId: 'p1', qtyPerUnit: 3, cutLengthCm: 150, cutWidthCm: null },
      ]);
      prisma.tenant.productCuttingSpec.findFirst.mockResolvedValue({ productId: 'p1', kind: 'BAR', stockLengthCm: 600, kerfMm: 0, minRemnantLengthCm: null });
      prisma.tenant.stockRemnant.findMany.mockResolvedValue([]);
      prisma.tenant.cuttingPlan.create.mockResolvedValue({ id: 'plan1', assemblyId: 'a1', warehouseId: 'w1', qty: 2, status: 'DRAFT' });
      prisma.tenant.cuttingPlanStock.create.mockResolvedValue({ id: 'stock1' });
      prisma.tenant.cuttingPlan.findUnique.mockResolvedValue({ id: 'plan1', assemblyId: 'a1', warehouseId: 'w1', qty: 2, status: 'DRAFT', stockItems: [] });

      const result = await service.preview(user, { assemblyId: 'a1', qty: 2, warehouseId: 'w1' });

      expect(prisma.tenant.cuttingPlan.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ assemblyId: 'a1', warehouseId: 'w1', status: 'DRAFT' }) }),
      );
      // 3 pieces/unit * qty 2 = 6 pieces of 150cm, each + 0 kerf, fits in one 600cm bar (6*150=900 > 600, so should overflow into 2 bars)
      expect(prisma.tenant.cuttingPlanStock.create).toHaveBeenCalled();
      expect(prisma.tenant.cuttingPlanCut.createMany).toHaveBeenCalled();
      expect(result.id).toBe('plan1');
    });

    it('routes a SHEET component with a real contour through the irregular nester, persisting shapePolygonCm/usedAreaCm2/wasteAreaCm2 instead of leftoverLengthCm/WidthCm', async () => {
      prisma.tenant.assembly.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.tenant.assemblyComponent.findMany.mockResolvedValue([
        {
          componentType: 'PRODUCT',
          productId: 'p1',
          qtyPerUnit: 1,
          cutLengthCm: 10,
          cutWidthCm: 10,
          cutShapePolygon: {
            outerCm: [
              [0, 0],
              [10, 0],
              [10, 10],
              [0, 10],
            ],
            holesCm: [],
          },
        },
      ]);
      prisma.tenant.productCuttingSpec.findFirst.mockResolvedValue({ productId: 'p1', kind: 'SHEET', stockLengthCm: 100, stockWidthCm: 100, kerfMm: 0, allowRotation: false });
      prisma.tenant.stockRemnant.findMany.mockResolvedValue([]);
      prisma.tenant.cuttingPlan.create.mockResolvedValue({ id: 'plan1', warehouseId: 'w1' });
      prisma.tenant.cuttingPlanStock.create.mockResolvedValue({ id: 'stock1' });
      prisma.tenant.cuttingPlan.findUnique.mockResolvedValue({ id: 'plan1', warehouseId: 'w1', status: 'DRAFT', stockItems: [] });

      await service.preview(user, { assemblyId: 'a1', qty: 1 });

      expect(prisma.tenant.cuttingPlanStock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            usedAreaCm2: expect.any(Number),
            wasteAreaCm2: expect.any(Number),
          }),
        }),
      );
      const stockCallData = prisma.tenant.cuttingPlanStock.create.mock.calls[0][0].data;
      expect(stockCallData.leftoverLengthCm).toBeUndefined();

      expect(prisma.tenant.cuttingPlanCut.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([expect.objectContaining({ shapePolygonCm: expect.objectContaining({ outerCm: expect.any(Array) }) })]),
        }),
      );
    });

    it('does not call the optimizer for a demand group whose product no longer has a cutting spec', async () => {
      prisma.tenant.assembly.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.tenant.assemblyComponent.findMany.mockResolvedValue([{ componentType: 'PRODUCT', productId: 'p1', qtyPerUnit: 1, cutLengthCm: 100 }]);
      prisma.tenant.productCuttingSpec.findFirst.mockResolvedValue(null);
      prisma.tenant.cuttingPlan.create.mockResolvedValue({ id: 'plan1', warehouseId: 'w1' });
      prisma.tenant.cuttingPlan.findUnique.mockResolvedValue({ id: 'plan1', warehouseId: 'w1', status: 'DRAFT', stockItems: [] });

      await service.preview(user, { assemblyId: 'a1', qty: 1 });

      expect(prisma.tenant.cuttingPlanStock.create).not.toHaveBeenCalled();
    });
  });

  describe('execute', () => {
    it('throws when the plan does not exist', async () => {
      prisma.tenant.cuttingPlan.findUnique.mockResolvedValue(null);

      await expect(service.execute(user, 'missing')).rejects.toThrow();
    });

    it('throws when the plan is already executed', async () => {
      prisma.tenant.cuttingPlan.findUnique.mockResolvedValue({ id: 'plan1', status: 'EXECUTED', stockItems: [] });

      await expect(service.execute(user, 'plan1')).rejects.toThrow();
    });

    it('marks a consumed remnant CONSUMED and creates a new remnant for leftover above threshold', async () => {
      prisma.tenant.cuttingPlan.findUnique
        .mockResolvedValueOnce({
          id: 'plan1',
          companyId: 'c1',
          assemblyId: 'a1',
          warehouseId: 'w1',
          qty: 1,
          status: 'DRAFT',
          stockItems: [{ id: 'stock1', productId: 'p1', sourceKind: 'REMNANT', remnantId: 'r1', leftoverLengthCm: 200, leftoverWidthCm: null }],
        })
        .mockResolvedValueOnce({ id: 'plan1', warehouseId: 'w1', status: 'EXECUTED', stockItems: [] }); // getDetail's own read at the end
      prisma.tenant.productCuttingSpec.findFirst.mockResolvedValue({ productId: 'p1', kind: 'BAR', minRemnantLengthCm: 50 });

      await service.execute(user, 'plan1');

      expect(prisma.tenant.stockRemnant.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'r1' }, data: expect.objectContaining({ status: 'CONSUMED' }) }),
      );
      expect(prisma.tenant.stockRemnant.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ productId: 'p1', warehouseId: 'w1', lengthCm: 200, status: 'AVAILABLE' }) }),
      );
      expect(prisma.tenant.cuttingPlanStock.update).toHaveBeenCalledWith({ where: { id: 'stock1' }, data: { newRemnantId: 'new-remnant-1' } });
      expect(prisma.tenant.cuttingPlan.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'plan1' }, data: expect.objectContaining({ status: 'EXECUTED' }) }),
      );
      expect(audit.record).toHaveBeenCalled();
    });

    it('does not create a new remnant when the leftover is below the minimum threshold', async () => {
      prisma.tenant.cuttingPlan.findUnique
        .mockResolvedValueOnce({
          id: 'plan1',
          companyId: 'c1',
          warehouseId: 'w1',
          status: 'DRAFT',
          stockItems: [{ id: 'stock1', productId: 'p1', sourceKind: 'FRESH', remnantId: null, leftoverLengthCm: 10, leftoverWidthCm: null }],
        })
        .mockResolvedValueOnce({ id: 'plan1', status: 'EXECUTED', stockItems: [] });
      prisma.tenant.productCuttingSpec.findFirst.mockResolvedValue({ productId: 'p1', kind: 'BAR', minRemnantLengthCm: 50 });

      await service.execute(user, 'plan1');

      expect(prisma.tenant.stockRemnant.create).not.toHaveBeenCalled();
    });
  });

  describe('upsertSpec', () => {
    it('rejects a SHEET spec with no stockWidthCm', async () => {
      await expect(service.upsertSpec(user, 'p1', { kind: 'SHEET' as any, stockLengthCm: 300 })).rejects.toThrow();
    });

    it('creates a new spec when none exists', async () => {
      prisma.tenant.productCuttingSpec.findFirst.mockResolvedValue(null);

      await service.upsertSpec(user, 'p1', { kind: 'BAR' as any, stockLengthCm: 600 });

      expect(prisma.tenant.productCuttingSpec.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ productId: 'p1', kind: 'BAR', stockLengthCm: 600, kerfMm: 3, allowRotation: true }) }),
      );
    });

    it('updates an existing spec in place rather than creating a duplicate', async () => {
      prisma.tenant.productCuttingSpec.findFirst.mockResolvedValue({ id: 'spec1', productId: 'p1' });

      await service.upsertSpec(user, 'p1', { kind: 'BAR' as any, stockLengthCm: 600 });

      expect(prisma.tenant.productCuttingSpec.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'spec1' } }));
      expect(prisma.tenant.productCuttingSpec.create).not.toHaveBeenCalled();
    });
  });
});
