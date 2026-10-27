import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ShipmentsService } from './shipments.service';

describe('ShipmentsService', () => {
  let service: ShipmentsService;
  let prisma: any;
  let audit: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  let assemblies: any;
  let transportUnitTypes: any;

  beforeEach(() => {
    prisma = {
      tenant: {
        finishedGood: { findMany: jest.fn(), updateMany: jest.fn() },
        shipment: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn(), delete: jest.fn() },
        assembly: { findMany: jest.fn().mockResolvedValue([]) },
      },
    };
    audit = { record: jest.fn() };
    assemblies = { calculateWeight: jest.fn().mockResolvedValue({ weightPerUnitKg: 0, complete: true, breakdown: [] }) };
    transportUnitTypes = { listActive: jest.fn().mockResolvedValue([]) };
    service = new ShipmentsService(prisma, audit, assemblies, transportUnitTypes);
  });

  describe('create', () => {
    it('rejects if any finished good id does not exist', async () => {
      prisma.tenant.finishedGood.findMany.mockResolvedValue([{ id: 'fg1', status: 'IN_STOCK' }]);
      await expect(
        service.create(user, { finishedGoodIds: ['fg1', 'fg2'] } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects if any finished good is not IN_STOCK', async () => {
      prisma.tenant.finishedGood.findMany.mockResolvedValue([
        { id: 'fg1', status: 'IN_STOCK', serialNumber: 'SN-1' },
        { id: 'fg2', status: 'SHIPPED', serialNumber: 'SN-2' },
      ]);
      await expect(
        service.create(user, { finishedGoodIds: ['fg1', 'fg2'] } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('creates the shipment and flips each finished good to SHIPPED', async () => {
      prisma.tenant.finishedGood.findMany.mockResolvedValue([
        { id: 'fg1', status: 'IN_STOCK' },
        { id: 'fg2', status: 'IN_STOCK' },
      ]);
      prisma.tenant.shipment.create.mockResolvedValue({ id: 'sh1', status: 'SHIPPED', items: [] });

      await service.create(user, { customerOrderId: 'co1', finishedGoodIds: ['fg1', 'fg2'] } as any);

      expect(prisma.tenant.finishedGood.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['fg1', 'fg2'] } },
        data: { status: 'SHIPPED', customerOrderId: 'co1' },
      });
    });
  });

  describe('markDelivered', () => {
    it('rejects an already-delivered shipment', async () => {
      prisma.tenant.shipment.findUnique.mockResolvedValue({ id: 'sh1', status: 'DELIVERED', items: [] });
      await expect(service.markDelivered(user, 'sh1')).rejects.toThrow(BadRequestException);
    });

    it('flips a SHIPPED shipment to DELIVERED with a deliveryDate', async () => {
      prisma.tenant.shipment.findUnique.mockResolvedValue({ id: 'sh1', status: 'SHIPPED', items: [] });
      prisma.tenant.shipment.update.mockResolvedValue({ id: 'sh1', status: 'DELIVERED' });

      await service.markDelivered(user, 'sh1');

      expect(prisma.tenant.shipment.update).toHaveBeenCalledWith({
        where: { id: 'sh1' },
        data: { status: 'DELIVERED', deliveryDate: expect.any(Date) },
      });
    });
  });

  describe('calculateMetrics', () => {
    it('groups by assembly, degrades place-count without packaging data, and sizes transport by the binding constraint', async () => {
      prisma.tenant.finishedGood.findMany.mockResolvedValue([
        { id: 'fg1', assemblyId: 'a1' },
        { id: 'fg2', assemblyId: 'a1' },
        { id: 'fg3', assemblyId: 'a1' },
        { id: 'fg4', assemblyId: 'a2' },
      ]);
      prisma.tenant.assembly.findMany.mockResolvedValue([
        { id: 'a1', name: 'Boxed widget', unitsPerBox: 2, boxesPerPallet: null, boxLengthCm: 50, boxWidthCm: 40, boxHeightCm: 30 },
        { id: 'a2', name: 'Loose widget', unitsPerBox: null, boxesPerPallet: null, boxLengthCm: null, boxWidthCm: null, boxHeightCm: null },
      ]);
      assemblies.calculateWeight.mockImplementation((_user: any, assemblyId: string) =>
        Promise.resolve({ weightPerUnitKg: assemblyId === 'a1' ? 10 : 5, complete: true, breakdown: [] }),
      );
      transportUnitTypes.listActive.mockResolvedValue([
        { id: 't1', name: 'Тент 20т', maxWeightKg: 20000, maxVolumeM3: 1, maxPackages: null },
      ]);

      const result = await service.calculateMetrics(user, ['fg1', 'fg2', 'fg3', 'fg4']);

      // a1: 3 units / 2 per box -> 2 boxes (no pallet config -> boxes are the place); a2: 1 unit, no box config -> 1 place
      expect(result.totalPlaces).toBe(3);
      expect(result.totalWeightKg).toBe(3 * 10 + 1 * 5);
      expect(result.weightIncomplete).toBe(false);
      // a2 has no box dimensions -> total volume is unknown, not understated
      expect(result.totalVolumeM3).toBeNull();
      expect(result.volumeIncomplete).toBe(true);
      expect(result.breakdown).toEqual([
        { assemblyId: 'a1', assemblyName: 'Boxed widget', count: 3, boxes: 2, pallets: null, weightKg: 30 },
        { assemblyId: 'a2', assemblyName: 'Loose widget', count: 1, boxes: 1, pallets: null, weightKg: 5 },
      ]);
      // volume-limited: unknown volume is skipped as a constraint, weight ratio 35/20000 is tiny -> still at least 1 truck
      expect(result.transportSuggestions).toEqual([{ typeId: 't1', name: 'Тент 20т', unitsNeeded: 1 }]);
    });

    it('sizes transport by weight when weight is the binding constraint', async () => {
      prisma.tenant.finishedGood.findMany.mockResolvedValue([{ id: 'fg1', assemblyId: 'a1' }]);
      prisma.tenant.assembly.findMany.mockResolvedValue([{ id: 'a1', name: 'Heavy widget', unitsPerBox: null, boxesPerPallet: null, boxLengthCm: null, boxWidthCm: null, boxHeightCm: null }]);
      assemblies.calculateWeight.mockResolvedValue({ weightPerUnitKg: 25000, complete: true, breakdown: [] });
      transportUnitTypes.listActive.mockResolvedValue([{ id: 't1', name: 'Тент 20т', maxWeightKg: 20000, maxVolumeM3: null, maxPackages: null }]);

      const result = await service.calculateMetrics(user, ['fg1']);

      expect(result.totalWeightKg).toBe(25000);
      // 25000 / 20000 = 1.25 -> ceil to 2 trucks
      expect(result.transportSuggestions).toEqual([{ typeId: 't1', name: 'Тент 20т', unitsNeeded: 2 }]);
    });
  });

  describe('remove', () => {
    it('rejects deleting an already-delivered shipment', async () => {
      prisma.tenant.shipment.findUnique.mockResolvedValue({ id: 'sh1', status: 'DELIVERED', items: [] });
      await expect(service.remove(user, 'sh1')).rejects.toThrow(ConflictException);
      expect(prisma.tenant.shipment.delete).not.toHaveBeenCalled();
    });

    it('reverts consumed finished goods back to IN_STOCK before deleting', async () => {
      prisma.tenant.shipment.findUnique.mockResolvedValue({
        id: 'sh1',
        status: 'SHIPPED',
        items: [{ finishedGoodId: 'fg1' }, { finishedGoodId: 'fg2' }],
      });

      await service.remove(user, 'sh1');

      expect(prisma.tenant.finishedGood.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['fg1', 'fg2'] }, status: 'SHIPPED' },
        data: { status: 'IN_STOCK' },
      });
      expect(prisma.tenant.shipment.delete).toHaveBeenCalledWith({ where: { id: 'sh1' } });
    });
  });
});
