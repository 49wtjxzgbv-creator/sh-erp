import { BadRequestException } from '@nestjs/common';
import { StockService } from './stock.service';

describe('StockService', () => {
  let service: StockService;
  let prisma: any;
  let audit: any;
  let stockReservationService: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  beforeEach(() => {
    prisma = {
      tenant: {
        warehouseStock: { upsert: jest.fn() },
        stockMovement: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
        product: { update: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
        warehouse: { findFirst: jest.fn().mockResolvedValue(null) },
      },
    };
    audit = { record: jest.fn() };
    stockReservationService = { topUp: jest.fn().mockResolvedValue(0), getGlobalShortageByProduct: jest.fn().mockResolvedValue(new Map()) };
    service = new StockService(prisma, audit, stockReservationService);
  });

  describe('applyMovement — atomicity and ledger correctness', () => {
    it('uses an atomic increment on WarehouseStock.qty, never read-then-write', async () => {
      prisma.tenant.warehouseStock.upsert.mockResolvedValue({ qty: 15 });
      prisma.tenant.stockMovement.create.mockResolvedValue({ id: 'm1' });

      await service.applyMovement(user, {
        productId: 'p1',
        warehouseId: 'w1',
        type: 'RECEIVE',
        qtyDelta: 5,
      });

      const upsertCall = prisma.tenant.warehouseStock.upsert.mock.calls[0][0];
      expect(upsertCall.update).toEqual({ qty: { increment: 5 } });
      expect(upsertCall.create.qty).toBe(5);
    });

    it('stamps qtyAfter on the StockMovement from the post-increment WarehouseStock value', async () => {
      prisma.tenant.warehouseStock.upsert.mockResolvedValue({ qty: 42 });
      prisma.tenant.stockMovement.create.mockResolvedValue({ id: 'm1' });

      await service.applyMovement(user, { productId: 'p1', warehouseId: 'w1', type: 'ADJUST', qtyDelta: -3 });

      expect(prisma.tenant.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ qtyAfter: 42, qtyDelta: -3 }) }),
      );
    });

    it('keeps Product.qty in sync via the same atomic increment (denormalized total cache)', async () => {
      prisma.tenant.warehouseStock.upsert.mockResolvedValue({ qty: 10 });
      prisma.tenant.stockMovement.create.mockResolvedValue({ id: 'm1' });

      await service.applyMovement(user, { productId: 'p1', warehouseId: 'w1', type: 'ISSUE', qtyDelta: -7 });

      expect(prisma.tenant.product.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { qty: { increment: -7 } },
      });
    });

    it('logs an audit event tagged with the movement type', async () => {
      prisma.tenant.warehouseStock.upsert.mockResolvedValue({ qty: 1 });
      prisma.tenant.stockMovement.create.mockResolvedValue({ id: 'm1' });

      await service.applyMovement(user, { productId: 'p1', warehouseId: 'w1', type: 'DEFECT_WRITE_OFF', qtyDelta: -1 });

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'stock.defect_write_off', entityType: 'StockMovement' }),
      );
    });

    it('skips the WarehouseStock allocation step when no warehouse is given, but still ledgers and updates Product.qty', async () => {
      prisma.tenant.stockMovement.create.mockResolvedValue({ id: 'm1' });

      await service.applyMovement(user, { productId: 'p1', warehouseId: null, type: 'ADJUST', qtyDelta: 2 });

      expect(prisma.tenant.warehouseStock.upsert).not.toHaveBeenCalled();
      expect(prisma.tenant.product.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { qty: { increment: 2 } },
      });
      expect(stockReservationService.topUp).not.toHaveBeenCalled();
    });

    it('§ simplified reservation spec: tops up outstanding order demand for any positive delta into a warehouse — a receipt or a plain manual addition', async () => {
      prisma.tenant.warehouseStock.upsert.mockResolvedValue({ qty: 15 });
      prisma.tenant.stockMovement.create.mockResolvedValue({ id: 'm1' });

      await service.applyMovement(user, { productId: 'p1', warehouseId: 'w1', type: 'ADJUST', qtyDelta: 5 });

      expect(stockReservationService.topUp).toHaveBeenCalledWith(user, {
        productId: 'p1',
        warehouseId: 'w1',
        qtyAvailable: 5,
        preferredOrderId: undefined,
      });
    });

    it('never tops up on a negative delta (consumption/write-off, not new supply)', async () => {
      prisma.tenant.warehouseStock.upsert.mockResolvedValue({ qty: 5 });
      prisma.tenant.stockMovement.create.mockResolvedValue({ id: 'm1' });

      await service.applyMovement(user, { productId: 'p1', warehouseId: 'w1', type: 'ISSUE', qtyDelta: -5 });

      expect(stockReservationService.topUp).not.toHaveBeenCalled();
    });

    it('passes preferredOrderId through to topUp when the movement is traceable to a specific order', async () => {
      prisma.tenant.warehouseStock.upsert.mockResolvedValue({ qty: 15 });
      prisma.tenant.stockMovement.create.mockResolvedValue({ id: 'm1' });

      await service.applyMovement(user, { productId: 'p1', warehouseId: 'w1', type: 'RECEIVE', qtyDelta: 10, preferredOrderId: 'co1' });

      expect(stockReservationService.topUp).toHaveBeenCalledWith(user, {
        productId: 'p1',
        warehouseId: 'w1',
        qtyAvailable: 10,
        preferredOrderId: 'co1',
      });
    });
  });

  describe('move — two correlated movements', () => {
    it('rejects moving stock to the same warehouse', async () => {
      await expect(
        service.move(user, { productId: 'p1', fromWarehouseId: 'w1', toWarehouseId: 'w1', qty: 5 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a non-positive quantity', async () => {
      await expect(
        service.move(user, { productId: 'p1', fromWarehouseId: 'w1', toWarehouseId: 'w2', qty: 0 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a negative movement out of the source and a positive movement into the destination, sharing one correlation id', async () => {
      prisma.tenant.warehouseStock.upsert.mockResolvedValueOnce({ qty: 5 }).mockResolvedValueOnce({ qty: 5 });
      prisma.tenant.stockMovement.create
        .mockResolvedValueOnce({ id: 'out1' })
        .mockResolvedValueOnce({ id: 'in1' });

      const result = await service.move(user, { productId: 'p1', fromWarehouseId: 'w1', toWarehouseId: 'w2', qty: 5 });

      const [outCall, inCall] = prisma.tenant.stockMovement.create.mock.calls;
      expect(outCall[0].data.qtyDelta).toBe(-5);
      expect(outCall[0].data.warehouseId).toBe('w1');
      expect(inCall[0].data.qtyDelta).toBe(5);
      expect(inCall[0].data.warehouseId).toBe('w2');
      expect(outCall[0].data.sourceId).toBe(inCall[0].data.sourceId); // same correlation id
      expect(result.correlationId).toBe(outCall[0].data.sourceId);
    });
  });

  describe('getLevels / getHistory filters', () => {
    it('filters levels by productId and warehouseId when given', async () => {
      prisma.tenant.warehouseStock.findMany = jest.fn().mockResolvedValue([]);
      await service.getLevels(user, { productId: 'p1', warehouseId: 'w1' });
      expect(prisma.tenant.warehouseStock.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { productId: 'p1', warehouseId: 'w1' } }),
      );
    });

    it('paginates history with sensible defaults', async () => {
      await service.getHistory(user, {});
      expect(prisma.tenant.stockMovement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50, skip: 0, orderBy: { createdAt: 'desc' } }),
      );
    });
  });
});
