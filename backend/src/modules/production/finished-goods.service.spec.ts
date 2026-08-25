import { NotFoundException } from '@nestjs/common';
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
        finishedGood: { count: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), createMany: jest.fn() },
        assembly: { findUnique: jest.fn() },
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
});
