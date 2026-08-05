import { FinishedGoodsService } from './finished-goods.service';

describe('FinishedGoodsService', () => {
  let service: FinishedGoodsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      tenant: {
        $executeRaw: jest.fn(),
        finishedGood: { count: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
      },
    };
    service = new FinishedGoodsService(prisma);
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
});
