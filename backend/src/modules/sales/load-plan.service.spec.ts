import { ConflictException, NotFoundException } from '@nestjs/common';
import { LoadPlanService } from './load-plan.service';

describe('LoadPlanService', () => {
  let service: LoadPlanService;
  let prisma: any;
  let audit: any;
  let assemblies: any;
  let transportUnitTypes: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  beforeEach(() => {
    prisma = {
      tenant: {
        customerOrder: { findUnique: jest.fn() },
        customerOrderItem: { findMany: jest.fn() },
        loadPlan: { findUnique: jest.fn(), deleteMany: jest.fn(), create: jest.fn() },
        loadPlanTruck: { create: jest.fn(), findFirst: jest.fn() },
        loadPlanItem: { createMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
        assembly: { findMany: jest.fn() },
        // Deliberately NO `$transaction` here — `prisma.tenant` inside a
        // request is already the per-request transaction client and has no
        // such method of its own (see load-plan.service.ts's own comment);
        // a regression that reintroduces `this.prisma.tenant.$transaction`
        // would throw "not a function" against this mock, same as it did
        // for real in production (2026-10-28).
      },
    };
    audit = { record: jest.fn() };
    assemblies = { calculateWeight: jest.fn() };
    transportUnitTypes = { findOne: jest.fn() };
    service = new LoadPlanService(prisma, audit, assemblies, transportUnitTypes);
  });

  describe('generate', () => {
    it('rejects when the order does not exist', async () => {
      prisma.tenant.customerOrder.findUnique.mockResolvedValue(null);
      await expect(service.generate(user, 'order-1', 'type-1')).rejects.toThrow(NotFoundException);
    });

    it('rejects when the transport type has no interior dimensions', async () => {
      prisma.tenant.customerOrder.findUnique.mockResolvedValue({ id: 'order-1' });
      transportUnitTypes.findOne.mockResolvedValue({ id: 'type-1', maxWeightKg: 20000, lengthCm: null, widthCm: null, heightCm: null });

      await expect(service.generate(user, 'order-1', 'type-1')).rejects.toThrow(ConflictException);
    });

    it('skips a line with no box packaging rather than blocking the whole plan', async () => {
      // "хай план всерівно генерує але без урахування того що нема"
      // (2026-10-28): a1 is packable, a2 is not — a2 must be left out of
      // every create() call, never referenced in any LoadPlanItem row.
      prisma.tenant.customerOrder.findUnique.mockResolvedValue({ id: 'order-1' });
      transportUnitTypes.findOne.mockResolvedValue({ id: 'type-1', maxWeightKg: 20000, lengthCm: 500, widthCm: 200, heightCm: 200 });
      prisma.tenant.customerOrderItem.findMany.mockResolvedValue([
        { id: 'item-1', assemblyId: 'a1', qty: '1', assembly: { id: 'a1', name: 'Packable', unitsPerBox: 1, boxLengthCm: '50', boxWidthCm: '40', boxHeightCm: '30' } },
        { id: 'item-2', assemblyId: 'a2', qty: '5', assembly: { id: 'a2', name: 'No packaging yet', unitsPerBox: null, boxLengthCm: null, boxWidthCm: null, boxHeightCm: null } },
      ]);
      assemblies.calculateWeight.mockResolvedValue({ weightPerUnitKg: 5, complete: true, breakdown: [] });
      prisma.tenant.loadPlan.deleteMany.mockResolvedValue({ count: 0 });
      prisma.tenant.loadPlan.create.mockResolvedValue({ id: 'plan-1' });
      prisma.tenant.loadPlanTruck.create.mockResolvedValue({ id: 'truck-1' });
      prisma.tenant.loadPlanItem.createMany.mockResolvedValue({ count: 1 });
      jest.spyOn(service, 'get').mockResolvedValue({ id: 'plan-1' } as any);

      await service.generate(user, 'order-1', 'type-1');

      expect(prisma.tenant.loadPlanTruck.create).toHaveBeenCalledTimes(1);
      expect(prisma.tenant.loadPlanItem.createMany).toHaveBeenCalledWith({
        data: [{ loadPlanTruckId: 'truck-1', customerOrderItemId: 'item-1', assemblyId: 'a1', unitsQty: 1 }],
      });
    });

    it('rejects when an order has no line items', async () => {
      prisma.tenant.customerOrder.findUnique.mockResolvedValue({ id: 'order-1' });
      transportUnitTypes.findOne.mockResolvedValue({ id: 'type-1', maxWeightKg: 20000, lengthCm: 500, widthCm: 200, heightCm: 200 });
      prisma.tenant.customerOrderItem.findMany.mockResolvedValue([]);

      await expect(service.generate(user, 'order-1', 'type-1')).rejects.toThrow(ConflictException);
    });

    it('packs the full ordered qty into trucks and persists the plan, then returns get()', async () => {
      prisma.tenant.customerOrder.findUnique.mockResolvedValue({ id: 'order-1' });
      transportUnitTypes.findOne.mockResolvedValue({ id: 'type-1', maxWeightKg: 20000, lengthCm: 500, widthCm: 200, heightCm: 200 });
      prisma.tenant.customerOrderItem.findMany.mockResolvedValue([
        {
          id: 'item-1',
          assemblyId: 'a1',
          qty: '3', // fractional-safe: Math.ceil would matter for e.g. '2.5'
          assembly: { id: 'a1', name: 'Widget', unitsPerBox: 2, boxLengthCm: '50', boxWidthCm: '40', boxHeightCm: '30' },
        },
      ]);
      assemblies.calculateWeight.mockResolvedValue({ weightPerUnitKg: 5, complete: true, breakdown: [] });
      prisma.tenant.loadPlan.deleteMany.mockResolvedValue({ count: 0 });
      prisma.tenant.loadPlan.create.mockResolvedValue({ id: 'plan-1' });
      prisma.tenant.loadPlanTruck.create.mockResolvedValue({ id: 'truck-1' });
      prisma.tenant.loadPlanItem.createMany.mockResolvedValue({ count: 2 });

      const getSpy = jest.spyOn(service, 'get').mockResolvedValue({ id: 'plan-1' } as any);

      const result = await service.generate(user, 'order-1', 'type-1');

      expect(prisma.tenant.loadPlan.deleteMany).toHaveBeenCalledWith({ where: { customerOrderId: 'order-1' } });
      expect(prisma.tenant.loadPlan.create).toHaveBeenCalledWith({
        data: { customerOrderId: 'order-1', transportUnitTypeId: 'type-1', createdById: user.userId },
      });
      // 3 units / 2 per box -> 2 boxes, both fit comfortably in one truck
      expect(prisma.tenant.loadPlanTruck.create).toHaveBeenCalledTimes(1);
      expect(prisma.tenant.loadPlanItem.createMany).toHaveBeenCalledWith({
        data: [{ loadPlanTruckId: 'truck-1', customerOrderItemId: 'item-1', assemblyId: 'a1', unitsQty: 3 }],
      });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'load_plan.generated' }));
      expect(getSpy).toHaveBeenCalledWith(user, 'order-1');
      expect(result).toEqual({ id: 'plan-1' });
    });
  });

  describe('get', () => {
    it('returns null when no plan exists for this order', async () => {
      prisma.tenant.loadPlan.findUnique.mockResolvedValue(null);
      expect(await service.get(user, 'order-1')).toBeNull();
    });

    it('recomputes a live 3D layout and weight/volume summary for each truck', async () => {
      prisma.tenant.loadPlan.findUnique.mockResolvedValue({
        id: 'plan-1',
        transportUnitTypeId: 'type-1',
        transportUnitType: { id: 'type-1', name: 'Тент 20т', lengthCm: '500', widthCm: '200', heightCm: '200', maxWeightKg: '20000' },
        trucks: [
          {
            id: 'truck-1',
            index: 1,
            items: [{ id: 'li-1', customerOrderItemId: 'item-1', assemblyId: 'a1', unitsQty: 2 }],
          },
        ],
      });
      prisma.tenant.assembly.findMany.mockResolvedValue([
        { id: 'a1', name: 'Widget', unitsPerBox: 1, boxLengthCm: '50', boxWidthCm: '40', boxHeightCm: '30' },
      ]);
      prisma.tenant.customerOrderItem.findMany.mockResolvedValue([
        { id: 'item-1', assemblyId: 'a1', assembly: { id: 'a1', name: 'Widget', boxLengthCm: '50', boxWidthCm: '40', boxHeightCm: '30' } },
      ]);
      assemblies.calculateWeight.mockResolvedValue({ weightPerUnitKg: 5, complete: true, breakdown: [] });

      const view = await service.get(user, 'order-1');

      expect(view!.transportUnitTypeName).toBe('Тент 20т');
      expect(view!.trucks).toHaveLength(1);
      const truck = view!.trucks[0];
      expect(truck.items).toEqual([{ id: 'li-1', customerOrderItemId: 'item-1', assemblyId: 'a1', assemblyName: 'Widget', unitsQty: 2, weightKg: 10 }]);
      expect(truck.placedBoxes).toHaveLength(2); // 2 units, 1 per box (unitsPerBox: 1)
      expect(truck.overflowBoxCount).toBe(0);
      expect(truck.totalWeightKg).toBe(10);
      expect(truck.volumeUsedPercent).toBeGreaterThan(0);
      expect(view!.skippedAssemblies).toEqual([]);
    });

    it('lists order lines still missing box dimensions as skippedAssemblies, independent of what is already in the plan', async () => {
      prisma.tenant.loadPlan.findUnique.mockResolvedValue({
        id: 'plan-1',
        transportUnitTypeId: 'type-1',
        transportUnitType: { id: 'type-1', name: 'Тент 20т', lengthCm: '500', widthCm: '200', heightCm: '200', maxWeightKg: '20000' },
        trucks: [],
      });
      prisma.tenant.assembly.findMany.mockResolvedValue([]);
      prisma.tenant.customerOrderItem.findMany.mockResolvedValue([
        { id: 'item-1', assemblyId: 'a1', qty: '1', assembly: { id: 'a1', name: 'Packable', unitsPerBox: 1, boxLengthCm: '50', boxWidthCm: '40', boxHeightCm: '30' } },
        { id: 'item-2', assemblyId: 'a2', qty: '1', assembly: { id: 'a2', name: 'No packaging yet', boxLengthCm: null, boxWidthCm: null, boxHeightCm: null } },
      ]);
      assemblies.calculateWeight.mockResolvedValue({ weightPerUnitKg: 5, complete: true, breakdown: [] });

      const view = await service.get(user, 'order-1');

      expect(view!.skippedAssemblies).toEqual([{ id: 'a2', name: 'No packaging yet', reason: 'missing-packaging' }]);
    });

    it('classifies a box too big for the truck envelope as does-not-fit, separately from missing-packaging', async () => {
      // Discovered live on order #441835: a box can have dimensions and
      // still be unpackable because it's simply bigger than the chosen
      // truck's own empty cargo envelope (or too heavy on its own) — this
      // must be left out of the plan the same way, but reported with a
      // different `reason` so the UI can point the user at "pick a bigger
      // truck" instead of "measure the 3D model" (2026-10-28).
      prisma.tenant.loadPlan.findUnique.mockResolvedValue({
        id: 'plan-1',
        transportUnitTypeId: 'type-1',
        transportUnitType: { id: 'type-1', name: 'Тент 20т', lengthCm: '500', widthCm: '200', heightCm: '200', maxWeightKg: '20000' },
        trucks: [],
      });
      prisma.tenant.assembly.findMany.mockResolvedValue([]);
      prisma.tenant.customerOrderItem.findMany.mockResolvedValue([
        { id: 'item-1', assemblyId: 'a1', qty: '1', assembly: { id: 'a1', name: 'Fits fine', unitsPerBox: 1, boxLengthCm: '50', boxWidthCm: '40', boxHeightCm: '30' } },
        { id: 'item-2', assemblyId: 'a2', qty: '1', assembly: { id: 'a2', name: 'Too long for this truck', unitsPerBox: 1, boxLengthCm: '600', boxWidthCm: '40', boxHeightCm: '30' } },
      ]);
      assemblies.calculateWeight.mockResolvedValue({ weightPerUnitKg: 5, complete: true, breakdown: [] });

      const view = await service.get(user, 'order-1');

      expect(view!.skippedAssemblies).toEqual([{ id: 'a2', name: 'Too long for this truck', reason: 'does-not-fit' }]);
    });
  });

  describe('moveItem', () => {
    it('rejects when no plan exists for this order', async () => {
      prisma.tenant.loadPlan.findUnique.mockResolvedValue(null);
      await expect(service.moveItem(user, 'order-1', 'item-1', 2)).rejects.toThrow(NotFoundException);
    });

    it('rejects when the item does not exist', async () => {
      prisma.tenant.loadPlan.findUnique.mockResolvedValue({ id: 'plan-1' });
      prisma.tenant.loadPlanItem.findUnique.mockResolvedValue(null);
      await expect(service.moveItem(user, 'order-1', 'item-1', 2)).rejects.toThrow(NotFoundException);
    });

    it('creates the target truck if it does not exist yet, then reassigns the item', async () => {
      prisma.tenant.loadPlan.findUnique.mockResolvedValue({ id: 'plan-1' });
      prisma.tenant.loadPlanItem.findUnique.mockResolvedValue({ id: 'item-1', loadPlanTruckId: 'truck-1' });
      prisma.tenant.loadPlanTruck.findFirst.mockResolvedValue(null);
      prisma.tenant.loadPlanTruck.create.mockResolvedValue({ id: 'truck-2' });
      jest.spyOn(service, 'get').mockResolvedValue({ id: 'plan-1' } as any);

      await service.moveItem(user, 'order-1', 'item-1', 2);

      expect(prisma.tenant.loadPlanTruck.create).toHaveBeenCalledWith({ data: { loadPlanId: 'plan-1', index: 2 } });
      expect(prisma.tenant.loadPlanItem.update).toHaveBeenCalledWith({ where: { id: 'item-1' }, data: { loadPlanTruckId: 'truck-2' } });
    });

    it('reuses an existing truck at the target index instead of creating a duplicate', async () => {
      prisma.tenant.loadPlan.findUnique.mockResolvedValue({ id: 'plan-1' });
      prisma.tenant.loadPlanItem.findUnique.mockResolvedValue({ id: 'item-1', loadPlanTruckId: 'truck-1' });
      prisma.tenant.loadPlanTruck.findFirst.mockResolvedValue({ id: 'truck-2' });
      jest.spyOn(service, 'get').mockResolvedValue({ id: 'plan-1' } as any);

      await service.moveItem(user, 'order-1', 'item-1', 2);

      expect(prisma.tenant.loadPlanTruck.create).not.toHaveBeenCalled();
      expect(prisma.tenant.loadPlanItem.update).toHaveBeenCalledWith({ where: { id: 'item-1' }, data: { loadPlanTruckId: 'truck-2' } });
    });
  });
});
