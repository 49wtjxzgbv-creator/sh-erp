import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CustomerOrdersService } from './customer-orders.service';

describe('CustomerOrdersService', () => {
  let service: CustomerOrdersService;
  let prisma: any;
  let audit: any;
  let productionOrdersService: any;
  let assembliesService: any;
  let stockReservationService: any;
  let shortageService: any;
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
        productionOrder: { findMany: jest.fn().mockResolvedValue([]) },
      },
    };
    audit = { record: jest.fn() };
    productionOrdersService = { create: jest.fn() };
    assembliesService = { calculateCost: jest.fn().mockResolvedValue({ costPerUnit: 0, breakdown: [] }) };
    stockReservationService = { releaseAllForOrder: jest.fn().mockResolvedValue(undefined) };
    shortageService = { ensureRequirementsAndAutoReserve: jest.fn().mockResolvedValue(undefined) };
    service = new CustomerOrdersService(prisma, audit, productionOrdersService, assembliesService, stockReservationService, shortageService);
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

    it('§ simplified spec: auto-reserves available raw materials by default, no manual decision required', async () => {
      prisma.tenant.customerOrder.create.mockResolvedValue({ id: 'co1', status: 'NEW', items: [] });
      await service.create(user, { clientName: 'Acme Client', items: [{ assemblyId: 'a1', qty: 3 }] });
      expect(shortageService.ensureRequirementsAndAutoReserve).toHaveBeenCalledWith(user, 'co1');
    });
  });

  describe('cancel', () => {
    it('rejects cancelling a COMPLETED order', async () => {
      prisma.tenant.customerOrder.findUnique.mockResolvedValue({ ...order, status: 'COMPLETED' });
      await expect(service.cancel(user, 'co1')).rejects.toThrow(BadRequestException);
    });

    it('§15: releases the order\'s active reservations (shared pool, order-level) before flipping status to CANCELLED', async () => {
      prisma.tenant.customerOrder.update.mockResolvedValue({ ...order, status: 'CANCELLED' });
      await service.cancel(user, 'co1');
      expect(stockReservationService.releaseAllForOrder).toHaveBeenCalledWith(user, 'co1');
      expect(prisma.tenant.customerOrder.update).toHaveBeenCalledWith({ where: { id: 'co1' }, data: { status: 'CANCELLED' } });
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

  describe('query — estimated/actual price totals', () => {
    it('sums estimated cost per unique assembly (not per line) and actual cost from started production orders only', async () => {
      prisma.tenant.customerOrder.findMany.mockResolvedValue([
        {
          id: 'co1',
          items: [
            { assemblyId: 'a1', qty: 3, productionOrderId: null },
            { assemblyId: 'a1', qty: 2, productionOrderId: 'po-started' }, // same assembly as line 1 — calculateCost should only be called once for a1
            { assemblyId: 'a2', qty: 1, productionOrderId: 'po-not-started' },
          ],
        },
      ]);
      prisma.tenant.customerOrder.count.mockResolvedValue(1);
      assembliesService.calculateCost.mockImplementation(async (_u: unknown, assemblyId: string) =>
        assemblyId === 'a1' ? { costPerUnit: 10, breakdown: [] } : { costPerUnit: 5, breakdown: [] },
      );
      prisma.tenant.productionOrder.findMany.mockResolvedValue([
        { id: 'po-started', totalLocalCostEur: 25 },
        { id: 'po-not-started', totalLocalCostEur: null },
      ]);

      const { items } = await service.query(user, {});

      expect(assembliesService.calculateCost).toHaveBeenCalledTimes(2); // a1, a2 — deduped across the two a1 lines
      // estimated: (3+2)*10 [a1] + 1*5 [a2] = 55
      expect(items[0].estimatedTotal).toBe(55);
      // actual: only po-started has a frozen cost (25); po-not-started (PLANNED, totalLocalCostEur null) contributes nothing
      expect(items[0].actualTotal).toBe(25);
      expect(items[0].items).toBeUndefined(); // raw item rows aren't part of the list payload, only the aggregated totals
    });

    it('reports null totals (not 0) when no line has a determined price yet', async () => {
      prisma.tenant.customerOrder.findMany.mockResolvedValue([{ id: 'co1', items: [{ assemblyId: 'a1', qty: 1, productionOrderId: null }] }]);
      prisma.tenant.customerOrder.count.mockResolvedValue(1);
      assembliesService.calculateCost.mockRejectedValue(new Error('no saved BOM version'));

      const { items } = await service.query(user, {});

      expect(items[0].estimatedTotal).toBeNull();
      expect(items[0].actualTotal).toBeNull();
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
