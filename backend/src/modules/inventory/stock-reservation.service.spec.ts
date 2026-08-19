import { ConflictException } from '@nestjs/common';
import { StockReservationService } from './stock-reservation.service';

describe('StockReservationService', () => {
  let service: StockReservationService;
  let prisma: any;
  let audit: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };
  const target = { productId: 'p1', warehouseId: 'w1', customerOrderId: 'co1' };

  beforeEach(() => {
    prisma = {
      tenant: {
        warehouseStock: { findUnique: jest.fn() },
        stockReservation: { upsert: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn(), aggregate: jest.fn().mockResolvedValue({ _sum: { consumedQty: null } }) },
        orderMaterialRequirement: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
        customerOrder: { findMany: jest.fn() },
        $queryRaw: jest.fn(),
        $executeRaw: jest.fn(),
      },
    };
    audit = { record: jest.fn() };
    service = new StockReservationService(prisma, audit);
  });

  describe('reserveFromStock — §2/§3/§16 (strict, availability-checked)', () => {
    it('grants the full requested qty when enough is available, and upserts the reservation row', async () => {
      // physical 50, reserved 0 before -> after granting 20, reservedQtyAfter=20
      prisma.tenant.$queryRaw.mockResolvedValue([{ reservedQtyBefore: 0, reservedQtyAfter: 20 }]);
      prisma.tenant.stockReservation.upsert.mockResolvedValue({ id: 'r1' });

      const result = await service.reserveFromStock(user, target, 20);

      expect(result).toEqual({ grantedQty: 20, shortfallQty: 0 });
      expect(prisma.tenant.stockReservation.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { customerOrderId_productId_warehouseId_source: { customerOrderId: 'co1', productId: 'p1', warehouseId: 'w1', source: 'STOCK' } },
          create: expect.objectContaining({ qty: 20, source: 'STOCK' }),
          update: { qty: { increment: 20 } },
        }),
      );
    });

    it('throws CodedConflictException with the real available amount when the full request cannot be granted (§16)', async () => {
      // Only 10 of the requested 20 could be granted (e.g. physical=50, already reserved=40 by others)
      prisma.tenant.$queryRaw.mockResolvedValue([{ reservedQtyBefore: 40, reservedQtyAfter: 50 }]);
      prisma.tenant.warehouseStock.findUnique.mockResolvedValue({ qty: 50, reservedQty: 50 }); // reflects the now-committed grant

      await expect(service.reserveFromStock(user, target, 20)).rejects.toThrow(ConflictException);
      // the reservation upsert still ran for the partially-granted amount — never silently discarded
      expect(prisma.tenant.stockReservation.upsert).toHaveBeenCalled();
    });

    it('never allows the request to be granted at all when nothing is available (no WarehouseStock row / zero physical stock)', async () => {
      prisma.tenant.$queryRaw.mockResolvedValue([]); // no matching row => 0 rows returned
      prisma.tenant.warehouseStock.findUnique.mockResolvedValue(null);

      await expect(service.reserveFromStock(user, target, 5)).rejects.toThrow(ConflictException);
      expect(prisma.tenant.stockReservation.upsert).not.toHaveBeenCalled();
    });

    it('is a no-op for a zero/negative request', async () => {
      const result = await service.reserveFromStock(user, target, 0);
      expect(result).toEqual({ grantedQty: 0, shortfallQty: 0 });
      expect(prisma.tenant.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('reserveCapped — never throws', () => {
    it('grants only what is actually available, without throwing, when the request exceeds available stock', async () => {
      prisma.tenant.$queryRaw.mockResolvedValue([{ reservedQtyBefore: 0, reservedQtyAfter: 8 }]);
      prisma.tenant.stockReservation.upsert.mockResolvedValue({ id: 'r1' });

      const result = await service.reserveCapped(user, { ...target, source: 'PURCHASE' }, 15);

      expect(result).toEqual({ grantedQty: 8, shortfallQty: 7 });
    });

    it('accumulates into the SAME reservation row across repeated calls (§7-equivalent — partial receipts)', async () => {
      prisma.tenant.$queryRaw.mockResolvedValueOnce([{ reservedQtyBefore: 0, reservedQtyAfter: 8 }]);
      await service.reserveCapped(user, { ...target, source: 'PURCHASE' }, 8);
      expect(prisma.tenant.stockReservation.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { qty: { increment: 8 } } }));

      prisma.tenant.$queryRaw.mockResolvedValueOnce([{ reservedQtyBefore: 8, reservedQtyAfter: 15 }]);
      await service.reserveCapped(user, { ...target, source: 'PURCHASE' }, 7);
      expect(prisma.tenant.stockReservation.upsert).toHaveBeenLastCalledWith(expect.objectContaining({ update: { qty: { increment: 7 } } }));
    });
  });

  describe('topUp — §ordering (any positive stock movement fills outstanding order demand)', () => {
    it('tops up the preferred order first, capped to its own outstanding need, before considering any other order', async () => {
      prisma.tenant.orderMaterialRequirement.findUnique.mockResolvedValue({ requiredQty: 20 }); // preferred order's requirement
      prisma.tenant.stockReservation.findMany.mockResolvedValue([]); // no active reservation yet for it -> outstanding = 20
      prisma.tenant.stockReservation.aggregate.mockResolvedValue({ _sum: { consumedQty: null } });
      prisma.tenant.$queryRaw.mockResolvedValue([{ reservedQtyBefore: 0, reservedQtyAfter: 12 }]); // only 12 actually grantable
      prisma.tenant.stockReservation.upsert.mockResolvedValue({ id: 'r1' });

      const leftover = await service.topUp(user, { productId: 'p1', warehouseId: 'w1', qtyAvailable: 12, preferredOrderId: 'co-preferred' });

      expect(prisma.tenant.stockReservation.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { customerOrderId_productId_warehouseId_source: expect.objectContaining({ customerOrderId: 'co-preferred', source: 'PURCHASE' }) } }),
      );
      expect(leftover).toBe(0);
    });

    it('fills whichever OTHER active order has been waiting longest with any remainder after the preferred order', async () => {
      // preferred order needs only 5, we have 12 available -> 7 left over for the oldest other order
      prisma.tenant.orderMaterialRequirement.findUnique.mockResolvedValueOnce({ requiredQty: 5 }); // preferred
      prisma.tenant.stockReservation.findMany.mockResolvedValueOnce([]); // preferred: nothing reserved yet
      prisma.tenant.$queryRaw.mockResolvedValueOnce([{ reservedQtyBefore: 0, reservedQtyAfter: 5 }]); // grants 5 to preferred
      prisma.tenant.stockReservation.upsert.mockResolvedValue({ id: 'r1' });

      prisma.tenant.orderMaterialRequirement.findMany.mockResolvedValue([
        { customerOrderId: 'co-old', customerOrder: { createdAt: new Date('2026-01-01') } },
        { customerOrderId: 'co-new', customerOrder: { createdAt: new Date('2026-02-01') } },
      ]);
      // getOutstandingForOrder for co-old: requirement + no existing reservation -> outstanding = 10
      prisma.tenant.orderMaterialRequirement.findUnique.mockResolvedValueOnce({ requiredQty: 10 });
      prisma.tenant.stockReservation.findMany.mockResolvedValueOnce([]);
      prisma.tenant.$queryRaw.mockResolvedValueOnce([{ reservedQtyBefore: 0, reservedQtyAfter: 7 }]); // grants the remaining 7 to co-old

      const leftover = await service.topUp(user, { productId: 'p1', warehouseId: 'w1', qtyAvailable: 12, preferredOrderId: 'co-preferred' });

      expect(prisma.tenant.orderMaterialRequirement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ productId: 'p1', customerOrderId: { not: 'co-preferred' } }) }),
      );
      expect(leftover).toBe(0);
    });

    it('leaves any true leftover unallocated once every outstanding order is satisfied (becomes ordinary free stock)', async () => {
      prisma.tenant.orderMaterialRequirement.findMany.mockResolvedValue([]); // no preferredOrderId given, no other orders waiting
      const leftover = await service.topUp(user, { productId: 'p1', warehouseId: 'w1', qtyAvailable: 9 });
      expect(leftover).toBe(9);
      expect(prisma.tenant.stockReservation.upsert).not.toHaveBeenCalled();
    });

    it('is a no-op for a zero/negative amount', async () => {
      const leftover = await service.topUp(user, { productId: 'p1', warehouseId: 'w1', qtyAvailable: 0 });
      expect(leftover).toBe(0);
      expect(prisma.tenant.orderMaterialRequirement.findMany).not.toHaveBeenCalled();
    });
  });

  describe('release — §15', () => {
    it('clamps the released amount to what the reservation actually still holds', async () => {
      prisma.tenant.stockReservation.findUnique.mockResolvedValue({ id: 'r1', qty: 5, consumedQty: 0, releasedQty: 0 });

      const released = await service.release(user, { ...target, source: 'STOCK' }, 20); // asking to release more than held

      expect(released).toBe(5);
      expect(prisma.tenant.stockReservation.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { qty: { decrement: 5 }, releasedQty: { increment: 5 } },
      });
      expect(prisma.tenant.$executeRaw).toHaveBeenCalled();
    });

    it('is a no-op when no reservation row exists', async () => {
      prisma.tenant.stockReservation.findUnique.mockResolvedValue(null);
      const released = await service.release(user, { ...target, source: 'STOCK' }, 5);
      expect(released).toBe(0);
      expect(prisma.tenant.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('releaseAllForOrder — order cancellation (§15)', () => {
    it('releases every active reservation (both sources) tied to the order', async () => {
      prisma.tenant.stockReservation.findMany.mockResolvedValue([
        { id: 'r1', productId: 'p1', warehouseId: 'w1', customerOrderId: 'co1', source: 'STOCK', qty: 5 },
        { id: 'r2', productId: 'p1', warehouseId: 'w1', customerOrderId: 'co1', source: 'PURCHASE', qty: 3 },
      ]);
      prisma.tenant.stockReservation.findUnique
        .mockResolvedValueOnce({ id: 'r1', qty: 5, consumedQty: 0, releasedQty: 0 })
        .mockResolvedValueOnce({ id: 'r2', qty: 3, consumedQty: 0, releasedQty: 0 });

      await service.releaseAllForOrder(user, 'co1');

      expect(prisma.tenant.stockReservation.update).toHaveBeenCalledTimes(2);
    });

    it('does nothing when the order has no active reservations', async () => {
      prisma.tenant.stockReservation.findMany.mockResolvedValue([]);
      await service.releaseAllForOrder(user, 'co1');
      expect(prisma.tenant.stockReservation.update).not.toHaveBeenCalled();
    });
  });

  describe('consume — §14 (issuing to production closes the hold, never touches physical stock itself)', () => {
    it('decrements the held qty and increments consumedQty, clamped to what is held', async () => {
      prisma.tenant.stockReservation.findUnique.mockResolvedValue({ id: 'r1', qty: 6, consumedQty: 0, releasedQty: 0 });

      const consumed = await service.consume(user, { ...target, source: 'STOCK' }, 6);

      expect(consumed).toBe(6);
      expect(prisma.tenant.stockReservation.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { qty: { decrement: 6 }, consumedQty: { increment: 6 } },
      });
    });
  });

  describe('getAvailability — §4', () => {
    it('computes available = physical - reserved', async () => {
      prisma.tenant.warehouseStock.findUnique.mockResolvedValue({ qty: 100, reservedQty: 65 });
      const availability = await service.getAvailability(user, 'p1', 'w1');
      expect(availability).toEqual({ physical: 100, reserved: 65, available: 35 });
    });

    it('treats a missing WarehouseStock row as all-zero', async () => {
      prisma.tenant.warehouseStock.findUnique.mockResolvedValue(null);
      const availability = await service.getAvailability(user, 'p1', 'w1');
      expect(availability).toEqual({ physical: 0, reserved: 0, available: 0 });
    });
  });

  describe('getBreakdown — §17 drill-down', () => {
    it('joins active reservations with the orders that hold them', async () => {
      prisma.tenant.stockReservation.findMany.mockResolvedValue([
        { customerOrderId: 'co-1001', source: 'STOCK', qty: 20 },
        { customerOrderId: 'co-1002', source: 'PURCHASE', qty: 30 },
      ]);
      prisma.tenant.customerOrder.findMany.mockResolvedValue([
        { id: 'co-1001', orderNumber: '1001', clientName: 'Client A' },
        { id: 'co-1002', orderNumber: '1002', clientName: 'Client B' },
      ]);

      const breakdown = await service.getBreakdown(user, 'p1', 'w1');

      expect(breakdown).toEqual([
        { customerOrderId: 'co-1001', orderNumber: '1001', clientName: 'Client A', source: 'STOCK', qty: 20 },
        { customerOrderId: 'co-1002', orderNumber: '1002', clientName: 'Client B', source: 'PURCHASE', qty: 30 },
      ]);
    });

    it('returns an empty list when nothing is reserved, without querying orders', async () => {
      prisma.tenant.stockReservation.findMany.mockResolvedValue([]);
      const breakdown = await service.getBreakdown(user, 'p1', 'w1');
      expect(breakdown).toEqual([]);
      expect(prisma.tenant.customerOrder.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getGlobalShortageByProduct — §warehouse-page red column', () => {
    it('sums outstanding (requiredQty - covered) across every active order, per product', async () => {
      prisma.tenant.orderMaterialRequirement.findMany.mockResolvedValue([
        { customerOrderId: 'co1', productId: 'p1', requiredQty: 20 },
        { customerOrderId: 'co2', productId: 'p1', requiredQty: 10 },
        { customerOrderId: 'co1', productId: 'p2', requiredQty: 5 },
      ]);
      prisma.tenant.stockReservation.findMany.mockResolvedValue([
        { customerOrderId: 'co1', productId: 'p1', qty: 8, consumedQty: 0 },
        { customerOrderId: 'co2', productId: 'p1', qty: 10, consumedQty: 0 }, // fully covered, contributes 0
        { customerOrderId: 'co1', productId: 'p2', qty: 5, consumedQty: 0 }, // fully covered, contributes 0
      ]);

      const shortage = await service.getGlobalShortageByProduct(user, 'w1');

      expect(shortage.get('p1')).toBe(12); // (20-8) + (10-10)=0 -> 12
      expect(shortage.has('p2')).toBe(false); // fully covered -> not present (only positive shortages kept)
    });

    it('returns an empty map when there are no active-order requirements at all', async () => {
      prisma.tenant.orderMaterialRequirement.findMany.mockResolvedValue([]);
      const shortage = await service.getGlobalShortageByProduct(user, 'w1');
      expect(shortage.size).toBe(0);
      expect(prisma.tenant.stockReservation.findMany).not.toHaveBeenCalled();
    });
  });
});
