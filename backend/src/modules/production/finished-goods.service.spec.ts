import { ConflictException, NotFoundException } from '@nestjs/common';
import { FinishedGoodsService } from './finished-goods.service';

describe('FinishedGoodsService', () => {
  let service: FinishedGoodsService;
  let prisma: any;
  let audit: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  beforeEach(() => {
    prisma = {
      tenant: {
        $executeRaw: jest.fn(),
        finishedGood: { count: jest.fn(), findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn(), delete: jest.fn(), groupBy: jest.fn() },
        assembly: { findUnique: jest.fn() },
        qcCheck: { count: jest.fn().mockResolvedValue(0) },
        shipmentItem: { count: jest.fn().mockResolvedValue(0) },
      },
    };
    audit = { record: jest.fn() };
    service = new FinishedGoodsService(prisma, audit);
  });

  it('returns an empty array without touching the database when count <= 0', async () => {
    const result = await service.generateSerialNumbers('c1', 0);
    expect(result).toEqual([]);
    expect(prisma.tenant.$executeRaw).not.toHaveBeenCalled();
  });

  it('takes the advisory lock before counting existing finished goods', async () => {
    prisma.tenant.finishedGood.count.mockResolvedValue(0);
    await service.generateSerialNumbers('c1', 1);
    expect(prisma.tenant.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('generates sequential SN-000001-style serials continuing from the existing count', async () => {
    prisma.tenant.finishedGood.count.mockResolvedValue(5);
    const result = await service.generateSerialNumbers('c1', 3);
    expect(result).toEqual(['SN-000006', 'SN-000007', 'SN-000008']);
  });

  it('zero-pads to 6 digits', async () => {
    prisma.tenant.finishedGood.count.mockResolvedValue(0);
    const result = await service.generateSerialNumbers('c1', 1);
    expect(result).toEqual(['SN-000001']);
  });

  describe('receivePurchased', () => {
    it('rejects when the assembly does not exist', async () => {
      prisma.tenant.assembly.findUnique.mockResolvedValue(null);
      await expect(service.receivePurchased(user, { assemblyId: 'a1', qty: 2, unitCostEur: 10 })).rejects.toThrow(NotFoundException);
      expect(prisma.tenant.finishedGood.createMany).not.toHaveBeenCalled();
    });

    it('creates one FinishedGood row per unit with productionOrderId null and both cost columns set to unitCostEur', async () => {
      prisma.tenant.assembly.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.tenant.finishedGood.count.mockResolvedValue(0);
      prisma.tenant.finishedGood.findMany.mockResolvedValue([{ id: 'fg1' }, { id: 'fg2' }]);

      const result = await service.receivePurchased(user, { assemblyId: 'a1', qty: 2, unitCostEur: 12.5, comment: 'From Acme Ltd' });

      expect(prisma.tenant.finishedGood.createMany).toHaveBeenCalledWith({
        data: [
          { serialNumber: 'SN-000001', assemblyId: 'a1', productionOrderId: null, status: 'IN_STOCK', unitCostLocalEur: 12.5, unitCostGermanEur: 12.5, comment: 'From Acme Ltd' },
          { serialNumber: 'SN-000002', assemblyId: 'a1', productionOrderId: null, status: 'IN_STOCK', unitCostLocalEur: 12.5, unitCostGermanEur: 12.5, comment: 'From Acme Ltd' },
        ],
      });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'finished_good.received_purchased' }));
      expect(result).toEqual([{ id: 'fg1' }, { id: 'fg2' }]);
    });
  });

  describe('query — scope filter (2026-08-30)', () => {
    it('applies the same IN_PROGRESS/READY where-clause shape as summaryByAssembly', async () => {
      prisma.tenant.finishedGood.findMany.mockResolvedValue([]);
      prisma.tenant.finishedGood.count.mockResolvedValue(0);
      await service.query(user, { scope: 'IN_PROGRESS' });
      expect(prisma.tenant.finishedGood.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { productionOrderId: { not: null }, confirmedByExecutionId: null } }),
      );
    });

    it('leaves the where clause untouched when scope is omitted', async () => {
      prisma.tenant.finishedGood.findMany.mockResolvedValue([]);
      prisma.tenant.finishedGood.count.mockResolvedValue(0);
      await service.query(user, { assemblyId: 'a1' });
      expect(prisma.tenant.finishedGood.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { assemblyId: 'a1' } }));
    });
  });

  describe('summaryByAssembly', () => {
    it('returns one { assemblyId, qty } line per assembly, counting only IN_STOCK units, when scope is omitted (old unfiltered behavior)', async () => {
      prisma.tenant.finishedGood.groupBy.mockResolvedValue([
        { assemblyId: 'a1', _count: { _all: 3 } },
        { assemblyId: 'a2', _count: { _all: 1 } },
      ]);
      const result = await service.summaryByAssembly(user);
      expect(prisma.tenant.finishedGood.groupBy).toHaveBeenCalledWith({
        by: ['assemblyId'],
        where: { status: 'IN_STOCK' },
        _count: { _all: true },
      });
      expect(result).toEqual([
        { assemblyId: 'a1', qty: 3 },
        { assemblyId: 'a2', qty: 1 },
      ]);
    });

    it('Склад "В роботі" (2026-08-30): scope=IN_PROGRESS filters to manufactured units not yet worker-confirmed', async () => {
      prisma.tenant.finishedGood.groupBy.mockResolvedValue([]);
      await service.summaryByAssembly(user, 'IN_PROGRESS');
      expect(prisma.tenant.finishedGood.groupBy).toHaveBeenCalledWith({
        by: ['assemblyId'],
        where: { status: 'IN_STOCK', productionOrderId: { not: null }, confirmedByExecutionId: null },
        _count: { _all: true },
      });
    });

    it('Склад "Готова продукція" (2026-08-30): scope=READY includes purchased units (no productionOrderId) OR manufactured-and-confirmed units', async () => {
      prisma.tenant.finishedGood.groupBy.mockResolvedValue([]);
      await service.summaryByAssembly(user, 'READY');
      expect(prisma.tenant.finishedGood.groupBy).toHaveBeenCalledWith({
        by: ['assemblyId'],
        where: { status: 'IN_STOCK', OR: [{ productionOrderId: null }, { confirmedByExecutionId: { not: null } }] },
        _count: { _all: true },
      });
    });
  });

  describe('remove', () => {
    it('rejects a unit that is not IN_STOCK, without touching the row', async () => {
      prisma.tenant.finishedGood.findUnique.mockResolvedValue({ id: 'fg1', status: 'SHIPPED' });
      await expect(service.remove(user, 'fg1')).rejects.toThrow(ConflictException);
      expect(prisma.tenant.finishedGood.delete).not.toHaveBeenCalled();
    });

    it('rejects an IN_STOCK unit that still has QC checks or shipment records attached', async () => {
      prisma.tenant.finishedGood.findUnique.mockResolvedValue({ id: 'fg1', status: 'IN_STOCK' });
      prisma.tenant.qcCheck.count.mockResolvedValue(1);
      await expect(service.remove(user, 'fg1')).rejects.toThrow(ConflictException);
      expect(prisma.tenant.finishedGood.delete).not.toHaveBeenCalled();
    });

    it('deletes a clean IN_STOCK unit and records an audit entry', async () => {
      const good = { id: 'fg1', status: 'IN_STOCK' };
      prisma.tenant.finishedGood.findUnique.mockResolvedValue(good);
      await service.remove(user, 'fg1');
      expect(prisma.tenant.finishedGood.delete).toHaveBeenCalledWith({ where: { id: 'fg1' } });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'finished_good.deleted', entityId: 'fg1' }));
    });
  });
});
