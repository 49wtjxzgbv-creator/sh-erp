import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CustomerOrdersService } from './customer-orders.service';

describe('CustomerOrdersService', () => {
  let service: CustomerOrdersService;
  let prisma: any;
  let audit: any;
  let productionOrdersService: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  const order = {
    id: 'co1',
    status: 'NEW',
    items: [
      { id: 'item1', assemblyId: 'a1', qty: 3, productionOrderId: null },
      { id: 'item2', assemblyId: 'a2', qty: 2, productionOrderId: 'po-existing' },
    ],
  };

  beforeEach(() => {
    prisma = {
      tenant: {
        customerOrder: { create: jest.fn(), findUnique: jest.fn().mockResolvedValue({ ...order }), findMany: jest.fn(), count: jest.fn(), update: jest.fn() },
        customerOrderItem: { update: jest.fn() },
      },
    };
    audit = { record: jest.fn() };
    productionOrdersService = { create: jest.fn() };
    service = new CustomerOrdersService(prisma, audit, productionOrdersService);
  });

  describe('create', () => {
    it('creates the order with nested items and status NEW', async () => {
      prisma.tenant.customerOrder.create.mockResolvedValue({ id: 'co1', status: 'NEW', items: [] });

      await service.create(user, {
        clientName: 'Acme Client',
        items: [{ assemblyId: 'a1', qty: 3 }],
      });

      expect(prisma.tenant.customerOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            clientName: 'Acme Client',
            status: 'NEW',
            priority: 'NORMAL',
            createdById: 'u1',
            items: { create: [{ assemblyId: 'a1', qty: 3 }] },
          }),
        }),
      );
    });
  });

  describe('cancel', () => {
    it('rejects cancelling a COMPLETED order', async () => {
      prisma.tenant.customerOrder.findUnique.mockResolvedValue({ ...order, status: 'COMPLETED' });
      await expect(service.cancel(user, 'co1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('giveItemToProduction', () => {
    it('rejects a line that has already been given to production', async () => {
      await expect(service.giveItemToProduction(user, 'co1', 'item2', {})).rejects.toThrow(BadRequestException);
      expect(productionOrdersService.create).not.toHaveBeenCalled();
    });

    it('rejects an item that does not belong to this order', async () => {
      await expect(service.giveItemToProduction(user, 'co1', 'not-an-item', {})).rejects.toThrow(NotFoundException);
    });

    it('creates a ProductionOrder and locks it onto the item, moving the order to IN_PRODUCTION', async () => {
      productionOrdersService.create.mockResolvedValue({ id: 'po-new', status: 'PLANNED' });

      const result = await service.giveItemToProduction(user, 'co1', 'item1', {});

      expect(productionOrdersService.create).toHaveBeenCalledWith(user, expect.objectContaining({ assemblyId: 'a1', unitsPlanned: 3 }));
      expect(prisma.tenant.customerOrderItem.update).toHaveBeenCalledWith({
        where: { id: 'item1' },
        data: { productionOrderId: 'po-new' },
      });
      expect(prisma.tenant.customerOrder.update).toHaveBeenCalledWith({ where: { id: 'co1' }, data: { status: 'IN_PRODUCTION' } });
      expect(result.productionOrder.id).toBe('po-new');
    });

    it('does not re-transition the order status if it is already past NEW', async () => {
      prisma.tenant.customerOrder.findUnique.mockResolvedValue({ ...order, status: 'IN_PRODUCTION' });
      productionOrdersService.create.mockResolvedValue({ id: 'po-new', status: 'PLANNED' });

      await service.giveItemToProduction(user, 'co1', 'item1', {});

      expect(prisma.tenant.customerOrder.update).not.toHaveBeenCalled();
    });
  });

  describe('giveAllToProduction', () => {
    it('only processes lines that have not already been given', async () => {
      productionOrdersService.create.mockResolvedValue({ id: 'po-new', status: 'PLANNED' });

      const results = await service.giveAllToProduction(user, 'co1');

      expect(productionOrdersService.create).toHaveBeenCalledTimes(1); // only item1 — item2 already has a productionOrderId
      expect(results).toHaveLength(1);
    });
  });
});
