import { SubAssemblyReservationService } from './sub-assembly-reservation.service';

describe('SubAssemblyReservationService', () => {
  let service: SubAssemblyReservationService;
  let prisma: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  beforeEach(() => {
    prisma = {
      tenant: {
        subAssemblyReservation: {
          upsert: jest.fn(),
          findUnique: jest.fn(),
          update: jest.fn(),
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn(),
        },
        customerOrder: { findMany: jest.fn().mockResolvedValue([]) },
      },
    };
    service = new SubAssemblyReservationService(prisma);
  });

  describe('consume', () => {
    it('keeps the row alive at qty:0 instead of deleting it, and increments consumedQty by the deducted amount (2026-09-17 fix)', async () => {
      prisma.tenant.subAssemblyReservation.findUnique.mockResolvedValue({ id: 'r1', qty: 2, consumedQty: 0 });

      await service.consume(user, 'co1', 'a1', 2);

      expect(prisma.tenant.subAssemblyReservation.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { qty: 0, consumedQty: { increment: 2 } },
      });
    });

    it('caps the consumedQty increment at whatever the claim actually had left, never over-crediting past the original claim', async () => {
      // Only 1 unit was ever claimed, but the batch pulled 3 units total
      // from stock (2 from elsewhere) — only the claimed 1 is this claim's own.
      prisma.tenant.subAssemblyReservation.findUnique.mockResolvedValue({ id: 'r1', qty: 1, consumedQty: 0 });

      await service.consume(user, 'co1', 'a1', 3);

      expect(prisma.tenant.subAssemblyReservation.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { qty: 0, consumedQty: { increment: 1 } },
      });
    });

    it('is a no-op when this order never claimed anything on this assembly', async () => {
      prisma.tenant.subAssemblyReservation.findUnique.mockResolvedValue(null);

      await service.consume(user, 'co1', 'a1', 2);

      expect(prisma.tenant.subAssemblyReservation.update).not.toHaveBeenCalled();
    });
  });

  describe('getClaimedIncludingConsumedForOrder', () => {
    it('sums the live qty and the already-consumed history — never shrinks back down just because the claim got used', async () => {
      prisma.tenant.subAssemblyReservation.findUnique.mockResolvedValue({ qty: 0, consumedQty: 2 });

      await expect(service.getClaimedIncludingConsumedForOrder(user, 'co1', 'a1')).resolves.toBe(2);
    });

    it('returns 0 when no claim was ever made', async () => {
      prisma.tenant.subAssemblyReservation.findUnique.mockResolvedValue(null);

      await expect(service.getClaimedIncludingConsumedForOrder(user, 'co1', 'a1')).resolves.toBe(0);
    });
  });

  describe('getClaimForOrder', () => {
    it('reports only the live outstanding claim — used by the shortage calc, which must NOT count already-consumed stock as still pending', async () => {
      prisma.tenant.subAssemblyReservation.findUnique.mockResolvedValue({ qty: 0, consumedQty: 2 });

      await expect(service.getClaimForOrder(user, 'co1', 'a1')).resolves.toBe(0);
    });
  });
});
