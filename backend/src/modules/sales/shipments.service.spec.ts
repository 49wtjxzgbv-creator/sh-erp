import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ShipmentsService } from './shipments.service';

describe('ShipmentsService', () => {
  let service: ShipmentsService;
  let prisma: any;
  let audit: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  beforeEach(() => {
    prisma = {
      tenant: {
        finishedGood: { findMany: jest.fn(), updateMany: jest.fn() },
        shipment: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn(), delete: jest.fn() },
      },
    };
    audit = { record: jest.fn() };
    service = new ShipmentsService(prisma, audit);
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
