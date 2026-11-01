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
        productCuttingSpec: {
          findFirst: jest.fn(),
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn(),
          update: jest.fn(),
          delete: jest.fn(),
          count: jest.fn().mockResolvedValue(0),
        },
        stockRemnant: {
          findMany: jest.fn().mockResolvedValue([]),
          update: jest.fn(),
          create: jest.fn().mockResolvedValue({ id: 'new-remnant-1' }),
          count: jest.fn().mockResolvedValue(0),
        },
        cuttingPlan: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), groupBy: jest.fn().mockResolvedValue([]) },
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

    it('throws when both assemblyId and productId are given', async () => {
      await expect(service.preview(user, { assemblyId: 'a1', productId: 'p1', qty: 1 })).rejects.toThrow();
    });

    it('throws when neither assemblyId nor productId is given', async () => {
      await expect(service.preview(user, { qty: 1 } as any)).rejects.toThrow();
    });

    it('throws when a direct-product preview has no cutting spec for the product', async () => {
      prisma.tenant.productCuttingSpec.findFirst.mockResolvedValue(null);

      await expect(service.preview(user, { productId: 'p1', qty: 1 })).rejects.toThrow();
    });

    it('throws when a direct-product preview has a spec but no default cut shape set', async () => {
      prisma.tenant.productCuttingSpec.findFirst.mockResolvedValue({ productId: 'p1', kind: 'BAR', defaultCutLengthCm: null });

      await expect(service.preview(user, { productId: 'p1', qty: 1 })).rejects.toThrow();
    });

    it('direct-product preview with a manual BAR default shape persists a plan with productId set, no assemblyId', async () => {
      prisma.tenant.productCuttingSpec.findFirst.mockResolvedValue({
        productId: 'p1',
        kind: 'BAR',
        stockLengthCm: 600,
        kerfMm: 0,
        minRemnantLengthCm: null,
        defaultCutLengthCm: 150,
        defaultCutWidthCm: null,
        defaultCutShapePolygon: null,
      });
      prisma.tenant.stockRemnant.findMany.mockResolvedValue([]);
      prisma.tenant.cuttingPlan.create.mockResolvedValue({ id: 'plan1', productId: 'p1', warehouseId: 'w1', qty: 3, status: 'DRAFT' });
      prisma.tenant.cuttingPlanStock.create.mockResolvedValue({ id: 'stock1' });
      prisma.tenant.cuttingPlan.findUnique.mockResolvedValue({ id: 'plan1', productId: 'p1', warehouseId: 'w1', qty: 3, status: 'DRAFT', stockItems: [] });

      const result = await service.preview(user, { productId: 'p1', qty: 3, warehouseId: 'w1' });

      expect(prisma.tenant.cuttingPlan.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ assemblyId: null, productId: 'p1', warehouseId: 'w1', status: 'DRAFT' }) }),
      );
      expect(prisma.tenant.cuttingPlanStock.create).toHaveBeenCalled();
      expect(prisma.tenant.cuttingPlanCut.createMany).toHaveBeenCalled();
      expect(result.id).toBe('plan1');
      // flattenCutDemand/assembly.findUnique must never be touched on the direct-product path
      expect(prisma.tenant.assembly.findUnique).not.toHaveBeenCalled();
      expect(prisma.tenant.assemblyComponent.findMany).not.toHaveBeenCalled();
    });

    it('direct-product preview with a default polygon shape routes through the irregular nester', async () => {
      prisma.tenant.productCuttingSpec.findFirst.mockResolvedValue({
        productId: 'p1',
        kind: 'SHEET',
        stockLengthCm: 100,
        stockWidthCm: 100,
        kerfMm: 0,
        allowRotation: false,
        defaultCutLengthCm: 10,
        defaultCutWidthCm: 10,
        defaultCutShapePolygon: {
          outerCm: [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
          ],
          holesCm: [],
        },
      });
      prisma.tenant.stockRemnant.findMany.mockResolvedValue([]);
      prisma.tenant.cuttingPlan.create.mockResolvedValue({ id: 'plan1', productId: 'p1', warehouseId: 'w1' });
      prisma.tenant.cuttingPlanStock.create.mockResolvedValue({ id: 'stock1' });
      prisma.tenant.cuttingPlan.findUnique.mockResolvedValue({ id: 'plan1', productId: 'p1', warehouseId: 'w1', status: 'DRAFT', stockItems: [] });

      await service.preview(user, { productId: 'p1', qty: 1 });

      expect(prisma.tenant.cuttingPlanCut.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([expect.objectContaining({ shapePolygonCm: expect.objectContaining({ outerCm: expect.any(Array) }) })]),
        }),
      );
    });

    it('throws when more than one of assemblyId/productId/lines is given', async () => {
      await expect(service.preview(user, { assemblyId: 'a1', lines: [{ materialProductId: 'p1', qty: 1, cutLengthCm: 10 }] } as any)).rejects.toThrow();
    });

    it('ad-hoc worksheet: throws when a referenced material has no cutting spec', async () => {
      prisma.tenant.productCuttingSpec.findMany.mockResolvedValue([]);

      await expect(
        service.preview(user, { lines: [{ materialProductId: 'missing-material', qty: 2, cutLengthCm: 100 }] } as any),
      ).rejects.toThrow();
    });

    it('ad-hoc worksheet: single material, multiple labeled positions, nested together with qty = sum of lines', async () => {
      prisma.tenant.productCuttingSpec.findMany.mockResolvedValue([{ productId: 'p1', kind: 'BAR', stockLengthCm: 600, kerfMm: 0, minRemnantLengthCm: null }]);
      prisma.tenant.productCuttingSpec.findFirst.mockResolvedValue({ productId: 'p1', kind: 'BAR', stockLengthCm: 600, kerfMm: 0, minRemnantLengthCm: null });
      prisma.tenant.stockRemnant.findMany.mockResolvedValue([]);
      prisma.tenant.cuttingPlan.create.mockResolvedValue({ id: 'plan1', warehouseId: 'w1' });
      prisma.tenant.cuttingPlanStock.create.mockResolvedValue({ id: 'stock1' });
      prisma.tenant.cuttingPlan.findUnique.mockResolvedValue({ id: 'plan1', warehouseId: 'w1', status: 'DRAFT', stockItems: [] });

      await service.preview(user, {
        lines: [
          { materialProductId: 'p1', label: 'кришка', qty: 2, cutLengthCm: 100 },
          { materialProductId: 'p1', label: 'бокова панель', qty: 1, cutLengthCm: 200 },
        ],
      } as any);

      expect(prisma.tenant.cuttingPlan.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ assemblyId: null, productId: null, qty: 3 }) }),
      );
      expect(prisma.tenant.cuttingPlanCut.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ pieceLabel: 'кришка' }),
            expect.objectContaining({ pieceLabel: 'бокова панель' }),
          ]),
        }),
      );
    });

    it('ad-hoc worksheet: two different materials group into separate stock items, unlabeled line has null pieceLabel', async () => {
      prisma.tenant.productCuttingSpec.findMany.mockResolvedValue([
        { productId: 'mat-bar', kind: 'BAR', stockLengthCm: 600, kerfMm: 0, minRemnantLengthCm: null },
        { productId: 'mat-sheet', kind: 'SHEET', stockLengthCm: 200, stockWidthCm: 150, kerfMm: 0, allowRotation: true },
      ]);
      prisma.tenant.productCuttingSpec.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.productId === 'mat-bar'
            ? { productId: 'mat-bar', kind: 'BAR', stockLengthCm: 600, kerfMm: 0, minRemnantLengthCm: null }
            : { productId: 'mat-sheet', kind: 'SHEET', stockLengthCm: 200, stockWidthCm: 150, kerfMm: 0, allowRotation: true },
        ),
      );
      prisma.tenant.stockRemnant.findMany.mockResolvedValue([]);
      prisma.tenant.cuttingPlan.create.mockResolvedValue({ id: 'plan1', warehouseId: 'w1' });
      prisma.tenant.cuttingPlanStock.create.mockResolvedValue({ id: 'stock1' });
      prisma.tenant.cuttingPlan.findUnique.mockResolvedValue({ id: 'plan1', warehouseId: 'w1', status: 'DRAFT', stockItems: [] });

      await service.preview(user, {
        lines: [
          { materialProductId: 'mat-bar', qty: 1, cutLengthCm: 150 },
          { materialProductId: 'mat-sheet', label: 'панель', qty: 1, cutLengthCm: 50, cutWidthCm: 40 },
        ],
      } as any);

      expect(prisma.tenant.cuttingPlanStock.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ productId: 'mat-bar' }) }));
      expect(prisma.tenant.cuttingPlanStock.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ productId: 'mat-sheet' }) }));
      expect(prisma.tenant.cuttingPlanCut.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ pieceLabel: null })]) }),
      );
      expect(prisma.tenant.cuttingPlanCut.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ pieceLabel: 'панель' })]) }),
      );
    });
  });

  describe('execute/getDetail on a productId-only plan', () => {
    it('executes a direct-product plan without touching any assembly', async () => {
      prisma.tenant.cuttingPlan.findUnique
        .mockResolvedValueOnce({
          id: 'plan1',
          companyId: 'c1',
          productId: 'p1',
          assemblyId: null,
          warehouseId: 'w1',
          qty: 1,
          status: 'DRAFT',
          stockItems: [{ id: 'stock1', productId: 'p1', sourceKind: 'FRESH', remnantId: null, leftoverLengthCm: 10, leftoverWidthCm: null }],
        })
        .mockResolvedValueOnce({ id: 'plan1', productId: 'p1', assemblyId: null, warehouseId: 'w1', status: 'EXECUTED', stockItems: [] });
      prisma.tenant.productCuttingSpec.findFirst.mockResolvedValue({ productId: 'p1', kind: 'BAR', minRemnantLengthCm: 50 });

      const result = await service.execute(user, 'plan1');

      expect(prisma.tenant.cuttingPlan.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'plan1' }, data: expect.objectContaining({ status: 'EXECUTED' }) }),
      );
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ after: expect.objectContaining({ assemblyId: null, productId: 'p1' }) }));
      expect(result.id).toBe('plan1');
    });
  });

  describe('listCuttableProducts', () => {
    it('merges per-product draft/executed plan counts onto each spec row', async () => {
      prisma.tenant.productCuttingSpec.findMany.mockResolvedValue([
        { productId: 'p1', kind: 'BAR', defaultCutLengthCm: 150, product: { id: 'p1', name: 'Rod', article: 'R1' } },
        { productId: 'p2', kind: 'SHEET', defaultCutLengthCm: null, product: { id: 'p2', name: 'Sheet', article: 'S1' } },
      ]);
      prisma.tenant.productCuttingSpec.count.mockResolvedValue(2);
      prisma.tenant.cuttingPlan.groupBy.mockResolvedValue([
        { productId: 'p1', status: 'DRAFT', _count: { _all: 2 }, _max: { createdAt: new Date('2026-11-01') } },
        { productId: 'p1', status: 'EXECUTED', _count: { _all: 1 }, _max: { createdAt: new Date('2026-10-01') } },
      ]);

      const result = await service.listCuttableProducts(user, {});

      expect(result.total).toBe(2);
      const p1 = result.items.find((i: any) => i.productId === 'p1')!;
      expect(p1.draftPlanCount).toBe(2);
      expect(p1.executedPlanCount).toBe(1);
      expect(p1.hasDefaultShape).toBe(true);
      expect(p1.lastPlanAt).toEqual(new Date('2026-11-01'));
      const p2 = result.items.find((i: any) => i.productId === 'p2')!;
      expect(p2.draftPlanCount).toBe(0);
      expect(p2.hasDefaultShape).toBe(false);
      expect(p2.lastPlanAt).toBeNull();
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
