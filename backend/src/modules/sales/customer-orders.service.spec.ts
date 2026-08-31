import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CustomerOrdersService } from './customer-orders.service';

describe('CustomerOrdersService', () => {
  let service: CustomerOrdersService;
  let prisma: any;
  let audit: any;
  let productionOrdersService: any;
  let assembliesService: any;
  let stockReservationService: any;
  let subAssemblyReservationService: any;
  let shortageService: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  const order = {
    id: 'co1',
    status: 'NEW',
    items: [
      { id: 'item1', assemblyId: 'a1', qty: 3 },
      { id: 'item2', assemblyId: 'a2', qty: 2 },
    ],
  };

  /**
   * findOne()/query() no longer read a direct `productionOrderId` FK off
   * CustomerOrderItem — batching support (План-графік §1) replaced that
   * 1:1 link with an indirect one: `getItemQuantitySummary`/`withPriceTotals`
   * both query `ProductionOrder.findMany({ where: { customerOrderItemId... } })`
   * and derive "remaining"/actual cost from THAT. The default `jest.fn()`
   * mock can't filter by its call arguments, so this makes the mock
   * actually behave like a real query, filtering `rows` by whichever shape
   * of `where.customerOrderItemId` the real code passes (a bare string from
   * getItemQuantitySummary, or `{ in: [...] }` from withPriceTotals).
   */
  function mockProductionOrdersFindMany(rows: any[]) {
    prisma.tenant.productionOrder.findMany.mockImplementation(({ where }: any) => {
      // OR-shaped queries from getItemProductionTree ({ customerOrderItemId }/{ subAssemblyForItemId })
      // and getPayrollFundSummary ({ customerOrderItemId: { in: [...] } }/{ subAssemblyForItemId: { in: [...] } })
      if (where?.OR) {
        return Promise.resolve(
          rows.filter((r) =>
            where.OR.some((cond: any) =>
              Object.entries(cond).every(([k, v]: [string, any]) => (v && typeof v === 'object' && 'in' in v ? v.in.includes(r[k]) : r[k] === v)),
            ),
          ),
        );
      }
      const filter = where?.customerOrderItemId;
      if (filter && typeof filter === 'object' && 'in' in filter) {
        return Promise.resolve(rows.filter((r) => filter.in.includes(r.customerOrderItemId)));
      }
      return Promise.resolve(rows.filter((r) => r.customerOrderItemId === filter));
    });
  }

  beforeEach(() => {
    prisma = {
      tenant: {
        customerOrder: { create: jest.fn(), findUnique: jest.fn().mockResolvedValue({ ...order }), findMany: jest.fn(), count: jest.fn(), update: jest.fn(), delete: jest.fn() },
        customerOrderItem: { create: jest.fn(), update: jest.fn() },
        productionOrder: { findMany: jest.fn() },
        finishedGood: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]) },
        payrollEntry: { findMany: jest.fn().mockResolvedValue([]) },
        assembly: { findMany: jest.fn().mockResolvedValue([]) },
        employee: { findMany: jest.fn().mockResolvedValue([]) },
      },
    };
    audit = { record: jest.fn() };
    productionOrdersService = { create: jest.fn() };
    assembliesService = {
      calculateCost: jest.fn().mockResolvedValue({ costPerUnit: 0, breakdown: [] }),
      getProductionTree: jest.fn(),
    };
    stockReservationService = { releaseAllForOrder: jest.fn().mockResolvedValue(undefined) };
    subAssemblyReservationService = { reserve: jest.fn().mockResolvedValue(undefined), releaseAllForOrder: jest.fn().mockResolvedValue(undefined) };
    shortageService = { ensureRequirementsAndAutoReserve: jest.fn().mockResolvedValue(undefined) };
    service = new CustomerOrdersService(prisma, audit, productionOrdersService, assembliesService, stockReservationService, subAssemblyReservationService, shortageService);

    // Default baseline matching `order` above: item2 already has its full
    // qty (2) given to production via one batch, item1 has none yet — the
    // scenario most tests in this file assume.
    mockProductionOrdersFindMany([{ id: 'po-existing', customerOrderItemId: 'item2', unitsPlanned: 2, status: 'PLANNED' }]);
  });

  describe('create', () => {
    it('creates the order header, then each item individually, with status NEW', async () => {
      prisma.tenant.customerOrder.create.mockResolvedValue({ id: 'co1', status: 'NEW' });
      prisma.tenant.customerOrderItem.create.mockResolvedValue({ id: 'item1', assemblyId: 'a1', qty: 3 });

      const result = await service.create(user, {
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
          }),
        }),
      );
      expect(prisma.tenant.customerOrderItem.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ customerOrderId: 'co1', assemblyId: 'a1', qty: 3 }),
      });
      expect(result.items).toEqual([{ id: 'item1', assemblyId: 'a1', qty: 3 }]);
    });

    it('§ simplified spec: auto-reserves available raw materials by default, no manual decision required', async () => {
      prisma.tenant.customerOrder.create.mockResolvedValue({ id: 'co1', status: 'NEW' });
      prisma.tenant.customerOrderItem.create.mockResolvedValue({ id: 'item1' });
      await service.create(user, { clientName: 'Acme Client', items: [{ assemblyId: 'a1', qty: 3 }] });
      expect(shortageService.ensureRequirementsAndAutoReserve).toHaveBeenCalledWith(user, 'co1');
    });

    it('sub-assembly planning (2026-08-27): records the "Підвироби" dialog choices as intent on the item (plannedSubAssemblies) WITHOUT creating any ProductionOrder', async () => {
      prisma.tenant.customerOrder.create.mockResolvedValue({ id: 'co1', status: 'NEW' });
      prisma.tenant.customerOrderItem.create.mockResolvedValue({ id: 'item1', assemblyId: 'a1', qty: 3 });

      await service.create(user, {
        clientName: 'Acme Client',
        items: [{ assemblyId: 'a1', qty: 3, subAssembliesToProduce: [{ assemblyId: 'sub1', qty: 6 }] }],
      });

      expect(prisma.tenant.customerOrderItem.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ plannedSubAssemblies: [{ assemblyId: 'sub1', qty: 6 }] }),
      });
      expect(productionOrdersService.create).not.toHaveBeenCalled();
    });

    it('does not set plannedSubAssemblies when the line has none requested', async () => {
      prisma.tenant.customerOrder.create.mockResolvedValue({ id: 'co1', status: 'NEW' });
      prisma.tenant.customerOrderItem.create.mockResolvedValue({ id: 'item1' });
      await service.create(user, { clientName: 'Acme Client', items: [{ assemblyId: 'a1', qty: 3 }] });
      expect(prisma.tenant.customerOrderItem.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ plannedSubAssemblies: undefined }),
      });
      expect(productionOrdersService.create).not.toHaveBeenCalled();
    });

    it('never flips the order to IN_PRODUCTION at creation, even when sub-assemblies were marked "Виготовити" (2026-08-27 decision — only an explicit "Передати у виробництво" click in Хід виробництва may do that)', async () => {
      prisma.tenant.customerOrder.create.mockResolvedValue({ id: 'co1', status: 'NEW' });
      prisma.tenant.customerOrderItem.create.mockResolvedValue({ id: 'item1', assemblyId: 'a1', qty: 3 });

      const result = await service.create(user, {
        clientName: 'Acme Client',
        items: [{ assemblyId: 'a1', qty: 3, subAssembliesToProduce: [{ assemblyId: 'sub1', qty: 6 }] }],
      });

      expect(prisma.tenant.customerOrder.update).not.toHaveBeenCalled();
      expect(result.status).toBe('NEW');
    });

    it('"Зі складу" choices (2026-08-27): claims a SubAssemblyReservation per line, separate from plannedSubAssemblies', async () => {
      prisma.tenant.customerOrder.create.mockResolvedValue({ id: 'co1', status: 'NEW' });
      prisma.tenant.customerOrderItem.create.mockResolvedValue({ id: 'item1', assemblyId: 'a1', qty: 3 });

      await service.create(user, {
        clientName: 'Acme Client',
        items: [{ assemblyId: 'a1', qty: 3, subAssembliesFromStock: [{ assemblyId: 'sub2', qty: 4 }] }],
      });

      expect(subAssemblyReservationService.reserve).toHaveBeenCalledWith(user, 'co1', 'sub2', 4);
    });

    it('claims nothing when the line has no "Зі складу" choices', async () => {
      prisma.tenant.customerOrder.create.mockResolvedValue({ id: 'co1', status: 'NEW' });
      prisma.tenant.customerOrderItem.create.mockResolvedValue({ id: 'item1' });
      await service.create(user, { clientName: 'Acme Client', items: [{ assemblyId: 'a1', qty: 3 }] });
      expect(subAssemblyReservationService.reserve).not.toHaveBeenCalled();
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
      expect(subAssemblyReservationService.releaseAllForOrder).toHaveBeenCalledWith(user, 'co1');
      expect(prisma.tenant.customerOrder.update).toHaveBeenCalledWith({ where: { id: 'co1' }, data: { status: 'CANCELLED' } });
    });
  });

  describe('remove — permanent hard delete', () => {
    it('releases the order\'s active reservations BEFORE deleting it, so WarehouseStock.reservedQty is correctly decremented (the DB-level cascade alone would strand it)', async () => {
      await service.remove(user, 'co1');

      const releaseCallOrder = stockReservationService.releaseAllForOrder.mock.invocationCallOrder[0];
      const deleteCallOrder = prisma.tenant.customerOrder.delete.mock.invocationCallOrder[0];

      expect(stockReservationService.releaseAllForOrder).toHaveBeenCalledWith(user, 'co1');
      expect(subAssemblyReservationService.releaseAllForOrder).toHaveBeenCalledWith(user, 'co1');
      expect(prisma.tenant.customerOrder.delete).toHaveBeenCalledWith({ where: { id: 'co1' } });
      expect(releaseCallOrder).toBeLessThan(deleteCallOrder);
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

    it('creates a ProductionOrder locked onto the item (via ProductionOrder.customerOrderItemId, batching support — no direct FK on the item anymore), moving the order to IN_PRODUCTION', async () => {
      productionOrdersService.create.mockResolvedValue({ id: 'po-new', status: 'PLANNED' });

      const result = await service.giveItemToProduction(user, 'co1', 'item1', {});

      expect(productionOrdersService.create).toHaveBeenCalledWith(
        user,
        expect.objectContaining({ assemblyId: 'a1', unitsPlanned: 3, customerOrderItemId: 'item1' }),
      );
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

  describe('giveSubAssemblyToProduction', () => {
    it('rejects an item that does not belong to this order', async () => {
      await expect(service.giveSubAssemblyToProduction(user, 'co1', 'not-an-item', { assemblyId: 'sub1', qty: 4 })).rejects.toThrow(NotFoundException);
      expect(productionOrdersService.create).not.toHaveBeenCalled();
    });

    it('plans a batch for the given tree node, linked via subAssemblyForItemId (never customerOrderItemId), moving the order to IN_PRODUCTION', async () => {
      productionOrdersService.create.mockResolvedValue({ id: 'po-sub', status: 'PLANNED' });

      const result = await service.giveSubAssemblyToProduction(user, 'co1', 'item1', { assemblyId: 'sub1', qty: 4 });

      expect(productionOrdersService.create).toHaveBeenCalledWith(user, { assemblyId: 'sub1', unitsPlanned: 4, subAssemblyForItemId: 'item1' });
      expect(prisma.tenant.customerOrder.update).toHaveBeenCalledWith({ where: { id: 'co1' }, data: { status: 'IN_PRODUCTION' } });
      expect(result.id).toBe('po-sub');
    });

    it('does not re-transition the order status if it is already past NEW', async () => {
      prisma.tenant.customerOrder.findUnique.mockResolvedValue({ ...order, status: 'IN_PRODUCTION' });
      productionOrdersService.create.mockResolvedValue({ id: 'po-sub', status: 'PLANNED' });

      await service.giveSubAssemblyToProduction(user, 'co1', 'item1', { assemblyId: 'sub1', qty: 4 });

      expect(prisma.tenant.customerOrder.update).not.toHaveBeenCalled();
    });
  });

  describe('getItemProductionTree', () => {
    it('rejects an item that does not belong to this order', async () => {
      await expect(service.getItemProductionTree(user, 'co1', 'not-an-item')).rejects.toThrow(NotFoundException);
    });

    it('attaches batches to each tree node by matching assemblyId, sourced from either customerOrderItemId or subAssemblyForItemId', async () => {
      assembliesService.getProductionTree.mockResolvedValue({
        assemblyId: 'a1',
        name: 'A1',
        article: null,
        qtyNeeded: 3,
        qtyInStock: 0,
        done: false,
        children: [
          { assemblyId: 'sub1', name: 'Sub1', article: null, qtyNeeded: 3, qtyInStock: 3, done: true, children: [] },
        ],
      });
      mockProductionOrdersFindMany([
        { id: 'po-top', assemblyId: 'a1', status: 'PLANNED', unitsPlanned: 3, customerOrderItemId: 'item1', subAssemblyForItemId: null },
        { id: 'po-sub', assemblyId: 'sub1', status: 'PLANNED', unitsPlanned: 3, customerOrderItemId: null, subAssemblyForItemId: 'item1' },
        { id: 'po-other', assemblyId: 'a1', status: 'PLANNED', unitsPlanned: 1, customerOrderItemId: 'item2', subAssemblyForItemId: null },
      ]);

      const result = await service.getItemProductionTree(user, 'co1', 'item1');

      expect(assembliesService.getProductionTree).toHaveBeenCalledWith(user, 'a1', 3, 'co1');
      expect(result.batches).toEqual([{ id: 'po-top', status: 'PLANNED', unitsPlanned: 3 }]);
      expect(result.children[0].batches).toEqual([{ id: 'po-sub', status: 'PLANNED', unitsPlanned: 3 }]);
    });

    it('attaches the "Підвироби"-dialog planned qty (item.plannedSubAssemblies) per node by assemblyId, null when a node was never marked', async () => {
      prisma.tenant.customerOrder.findUnique.mockResolvedValue({
        ...order,
        items: [{ id: 'item1', assemblyId: 'a1', qty: 3, plannedSubAssemblies: [{ assemblyId: 'sub1', qty: 6 }] }, order.items[1]],
      });
      assembliesService.getProductionTree.mockResolvedValue({
        assemblyId: 'a1',
        name: 'A1',
        article: null,
        qtyNeeded: 3,
        qtyInStock: 0,
        done: false,
        children: [
          { assemblyId: 'sub1', name: 'Sub1', article: null, qtyNeeded: 6, qtyInStock: 0, done: false, children: [] },
          { assemblyId: 'sub2', name: 'Sub2', article: null, qtyNeeded: 3, qtyInStock: 0, done: false, children: [] },
        ],
      });
      mockProductionOrdersFindMany([]);

      const result = await service.getItemProductionTree(user, 'co1', 'item1');

      expect(result.planned).toBeNull();
      expect(result.children[0].planned).toBe(6);
      expect(result.children[1].planned).toBeNull();
    });
  });

  describe('getPayrollFundSummary', () => {
    it('estimated sums laborFundEstimate across every node of every item\'s full tree; actual sums frozen laborCostEur from started batches only (PLANNED batches contribute 0)', async () => {
      assembliesService.getProductionTree.mockImplementation(async (_u: unknown, assemblyId: string) =>
        assemblyId === 'a1'
          ? {
              assemblyId: 'a1',
              name: 'Widget',
              article: 'W-1',
              qtyNeeded: 2,
              laborFundEstimate: 10,
              children: [{ assemblyId: 'sub1', name: 'Sub', article: 'S-1', qtyNeeded: 4, laborFundEstimate: 4, children: [] }],
            }
          : { assemblyId: 'a2', name: 'Gadget', article: 'G-1', qtyNeeded: 1, laborFundEstimate: 5, children: [] },
      );
      mockProductionOrdersFindMany([
        { id: 'po1', customerOrderItemId: 'item1', subAssemblyForItemId: null, laborCostEur: 12 }, // started — counts
        { id: 'po2', customerOrderItemId: null, subAssemblyForItemId: 'item1', laborCostEur: 3 }, // started sub-assembly batch — counts
        { id: 'po3', customerOrderItemId: 'item2', subAssemblyForItemId: null, laborCostEur: null }, // still PLANNED — contributes 0
        { id: 'po-unrelated', customerOrderItemId: 'not-this-order-item', subAssemblyForItemId: null, laborCostEur: 999 }, // excluded
      ]);

      const result = await service.getPayrollFundSummary(user, 'co1');

      expect(result.estimated).toBe(19);
      expect(result.actual).toBe(15);
      expect(result.earnedActual).toBe(0);
      expect(result.byArticle).toEqual([]);
      expect(result.estimatedByArticle).toEqual([
        { assemblyId: 'a2', assemblyName: 'Gadget', article: 'G-1', qtyNeeded: 1, estimatedAmount: 5 },
        { assemblyId: 'sub1', assemblyName: 'Sub', article: 'S-1', qtyNeeded: 4, estimatedAmount: 4 },
        { assemblyId: 'a1', assemblyName: 'Widget', article: 'W-1', qtyNeeded: 2, estimatedAmount: 10 },
      ]);
    });

    it('earnedActual/byArticle (2026-08-30): sums REAL PayrollEntry PIECEWORK rows for this order\'s batches, grouped by article via each batch\'s own assemblyId', async () => {
      assembliesService.getProductionTree.mockResolvedValue({ assemblyId: 'a1', laborFundEstimate: 0, children: [] });
      mockProductionOrdersFindMany([
        { id: 'po1', customerOrderItemId: 'item1', subAssemblyForItemId: null, laborCostEur: 12, assemblyId: 'a1' },
        { id: 'po2', customerOrderItemId: null, subAssemblyForItemId: 'item1', laborCostEur: 3, assemblyId: 'sub1' },
      ]);
      prisma.tenant.payrollEntry.findMany.mockResolvedValue([
        { employeeId: 'e1', type: 'PIECEWORK', amount: 100, unitsProduced: 4, productionOrderId: 'po1' },
        { employeeId: 'e2', type: 'PIECEWORK', amount: 20, unitsProduced: 2, productionOrderId: 'po1' }, // same article, different worker — merged
        { employeeId: 'e1', type: 'PIECEWORK', amount: 30, unitsProduced: 1, productionOrderId: 'po2' },
      ]);
      prisma.tenant.assembly.findMany.mockResolvedValue([
        { id: 'a1', name: 'Widget', article: 'W-1' },
        { id: 'sub1', name: 'Sub', article: 'S-1' },
      ]);

      const result = await service.getPayrollFundSummary(user, 'co1');

      expect(result.earnedActual).toBe(150);
      expect(result.byArticle).toEqual([
        { assemblyId: 'sub1', assemblyName: 'Sub', article: 'S-1', unitsProduced: 1, amount: 30 },
        { assemblyId: 'a1', assemblyName: 'Widget', article: 'W-1', unitsProduced: 6, amount: 120 },
      ]);
      expect(prisma.tenant.payrollEntry.findMany).toHaveBeenCalledWith({
        where: { type: 'PIECEWORK', productionOrderId: { in: ['po1', 'po2'] } },
      });
    });

    it('never lets ADVANCE/BONUS/PENALTY entries leak into earnedActual/byArticle (fund summary is piecework-only)', async () => {
      assembliesService.getProductionTree.mockResolvedValue({ assemblyId: 'a1', laborFundEstimate: 0, children: [] });
      mockProductionOrdersFindMany([{ id: 'po1', customerOrderItemId: 'item1', subAssemblyForItemId: null, laborCostEur: 0, assemblyId: 'a1' }]);
      // The real query already filters type: 'PIECEWORK' server-side — this
      // confirms the WHERE clause itself, not just in-memory filtering.
      await service.getPayrollFundSummary(user, 'co1');
      expect(prisma.tenant.payrollEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ type: 'PIECEWORK' }) }));
    });
  });

  describe('getOrderPayrollByEmployee (2026-08-30): "По працівниках" tab', () => {
    it('groups PIECEWORK entries by employee, each with their own total and article/qty/amount breakdown', async () => {
      mockProductionOrdersFindMany([
        { id: 'po1', customerOrderItemId: 'item1', subAssemblyForItemId: null, assemblyId: 'a1' },
        { id: 'po2', customerOrderItemId: null, subAssemblyForItemId: 'item1', assemblyId: 'sub1' },
      ]);
      prisma.tenant.payrollEntry.findMany.mockResolvedValue([
        { employeeId: 'e1', type: 'PIECEWORK', amount: 100, unitsProduced: 4, productionOrderId: 'po1' },
        { employeeId: 'e2', type: 'PIECEWORK', amount: 20, unitsProduced: 2, productionOrderId: 'po1' },
        { employeeId: 'e1', type: 'PIECEWORK', amount: 30, unitsProduced: 1, productionOrderId: 'po2' },
      ]);
      prisma.tenant.employee.findMany.mockResolvedValue([
        { id: 'e1', fullName: 'Іван Іванов' },
        { id: 'e2', fullName: 'Петро Петров' },
      ]);
      prisma.tenant.assembly.findMany.mockResolvedValue([
        { id: 'a1', name: 'Widget', article: 'W-1' },
        { id: 'sub1', name: 'Sub', article: 'S-1' },
      ]);

      const result = await service.getOrderPayrollByEmployee(user, 'co1');

      expect(result).toEqual([
        {
          employeeId: 'e1',
          employeeName: 'Іван Іванов',
          totalEarned: 130,
          byArticle: [
            { assemblyId: 'sub1', assemblyName: 'Sub', article: 'S-1', unitsProduced: 1, amount: 30 },
            { assemblyId: 'a1', assemblyName: 'Widget', article: 'W-1', unitsProduced: 4, amount: 100 },
          ],
        },
        {
          employeeId: 'e2',
          employeeName: 'Петро Петров',
          totalEarned: 20,
          byArticle: [{ assemblyId: 'a1', assemblyName: 'Widget', article: 'W-1', unitsProduced: 2, amount: 20 }],
        },
      ]);
    });

    it('returns [] without querying anything else when the order has no production batches yet', async () => {
      mockProductionOrdersFindMany([]);
      const result = await service.getOrderPayrollByEmployee(user, 'co1');
      expect(result).toEqual([]);
      expect(prisma.tenant.payrollEntry.findMany).not.toHaveBeenCalled();
    });

    it('returns [] when batches exist but nobody has been paid PIECEWORK yet', async () => {
      mockProductionOrdersFindMany([{ id: 'po1', customerOrderItemId: 'item1', subAssemblyForItemId: null, assemblyId: 'a1' }]);
      prisma.tenant.payrollEntry.findMany.mockResolvedValue([]);
      const result = await service.getOrderPayrollByEmployee(user, 'co1');
      expect(result).toEqual([]);
      expect(prisma.tenant.employee.findMany).not.toHaveBeenCalled();
    });
  });

  describe('query — estimated/actual price totals', () => {
    it('sums estimated cost per unique assembly (not per line) and actual cost from started production orders only', async () => {
      prisma.tenant.customerOrder.findMany.mockResolvedValue([
        {
          id: 'co1',
          items: [
            { id: 'line1', assemblyId: 'a1', qty: 3 },
            { id: 'line2', assemblyId: 'a1', qty: 2 }, // same assembly as line 1 — calculateCost should only be called once for a1
            { id: 'line3', assemblyId: 'a2', qty: 1 },
          ],
        },
      ]);
      prisma.tenant.customerOrder.count.mockResolvedValue(1);
      assembliesService.calculateCost.mockImplementation(async (_u: unknown, assemblyId: string) =>
        assemblyId === 'a1' ? { costPerUnit: 10, breakdown: [] } : { costPerUnit: 5, breakdown: [] },
      );
      // Actual cost is looked up via ProductionOrder.customerOrderItemId
      // (batching support, §14/§16) — line2's batch has started (frozen
      // cost 25), line3's has not (totalLocalCostEur still null), line1
      // has no batch at all yet.
      mockProductionOrdersFindMany([
        { id: 'po-started', customerOrderItemId: 'line2', totalLocalCostEur: 25 },
        { id: 'po-not-started', customerOrderItemId: 'line3', totalLocalCostEur: null },
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

  describe('query — percentComplete (2026-08-30, "План виробництва" list)', () => {
    it('percent = confirmed-and-paid FinishedGood units / ordered qty, scoped to each item\'s OWN top-level batches only', async () => {
      prisma.tenant.customerOrder.findMany.mockResolvedValue([
        { id: 'co1', items: [{ id: 'line1', assemblyId: 'a1', qty: 10 }] },
      ]);
      prisma.tenant.customerOrder.count.mockResolvedValue(1);
      assembliesService.calculateCost.mockResolvedValue({ costPerUnit: 1, breakdown: [] });
      // Only the top-level batch (customerOrderItemId) counts — a sub-assembly
      // batch (subAssemblyForItemId) must never leak into this %.
      prisma.tenant.productionOrder.findMany.mockResolvedValue([
        { id: 'po1', customerOrderItemId: 'line1', totalLocalCostEur: null },
        { id: 'po-sub', customerOrderItemId: null, subAssemblyForItemId: 'line1', totalLocalCostEur: null },
      ]);
      prisma.tenant.finishedGood.findMany.mockResolvedValue([
        { productionOrderId: 'po1' },
        { productionOrderId: 'po1' },
        { productionOrderId: 'po1' },
        { productionOrderId: 'po-sub' }, // confirmed sub-assembly unit — must not count toward line1's own %
      ]);

      const { items } = await service.query(user, {});

      expect(prisma.tenant.finishedGood.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { productionOrderId: { in: ['po1', 'po-sub'] }, confirmedByExecutionId: { not: null } } }),
      );
      expect(items[0].percentComplete).toBe(30); // 3 confirmed on po1 / 10 ordered = 30%, po-sub's unit excluded
    });

    it('is null (not 0) when nothing is ordered yet, and caps at 100 rather than overshooting', async () => {
      prisma.tenant.customerOrder.findMany.mockResolvedValueOnce([{ id: 'co-empty', items: [] }]);
      prisma.tenant.customerOrder.count.mockResolvedValueOnce(1);
      const empty = await service.query(user, {});
      expect(empty.items[0].percentComplete).toBeNull();

      prisma.tenant.customerOrder.findMany.mockResolvedValueOnce([{ id: 'co2', items: [{ id: 'line1', assemblyId: 'a1', qty: 2 }] }]);
      prisma.tenant.customerOrder.count.mockResolvedValueOnce(1);
      assembliesService.calculateCost.mockResolvedValue({ costPerUnit: 1, breakdown: [] });
      prisma.tenant.productionOrder.findMany.mockResolvedValue([{ id: 'po1', customerOrderItemId: 'line1', totalLocalCostEur: null }]);
      // More confirmed units than were ever ordered (e.g. a correction/rework churn) — % must not exceed 100.
      prisma.tenant.finishedGood.findMany.mockResolvedValue([{ productionOrderId: 'po1' }, { productionOrderId: 'po1' }, { productionOrderId: 'po1' }]);
      const over = await service.query(user, {});
      expect(over.items[0].percentComplete).toBe(100);
    });
  });

  describe('getOrderProductionUnits (2026-08-30, fixed 2026-08-31): "В роботі" / "Що зроблено" tabs', () => {
    it('splits every batch\'s (top-level AND sub-assembly) FinishedGood units into inProgress/ready buckets, grouped by article', async () => {
      mockProductionOrdersFindMany([
        { id: 'po-top', customerOrderItemId: 'item1', assemblyId: 'a-top' },
        { id: 'po-sub', customerOrderItemId: null, subAssemblyForItemId: 'item1', assemblyId: 'a-sub' },
      ]);
      prisma.tenant.assembly.findMany.mockResolvedValue([
        { id: 'a-top', name: 'Top Assembly', article: 'T-1' },
        { id: 'a-sub', name: 'Sub Assembly', article: 'S-1' },
      ]);
      prisma.tenant.finishedGood.groupBy.mockImplementation(({ where }: any) => {
        const isReady = where.confirmedByExecutionId !== null;
        return Promise.resolve(isReady ? [{ assemblyId: 'a-top', _count: { _all: 4 } }] : [{ assemblyId: 'a-sub', _count: { _all: 6 } }]);
      });

      const result = await service.getOrderProductionUnits(user, 'co1');

      expect(result.ready).toEqual([{ assemblyId: 'a-top', assemblyName: 'Top Assembly', article: 'T-1', qty: 4 }]);
      expect(result.inProgress).toEqual([{ assemblyId: 'a-sub', assemblyName: 'Sub Assembly', article: 'S-1', qty: 6 }]);
      expect(prisma.tenant.finishedGood.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            productionOrderId: { in: ['po-top', 'po-sub'] },
            status: { in: ['IN_STOCK', 'CONSUMED', 'SHIPPED'] },
            confirmedByExecutionId: { not: null },
          }),
        }),
      );
      expect(prisma.tenant.finishedGood.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            productionOrderId: { in: ['po-top', 'po-sub'] },
            status: { in: ['IN_STOCK', 'CONSUMED', 'SHIPPED'] },
            confirmedByExecutionId: null,
          }),
        }),
      );
    });

    it('READY requires confirmedByExecutionId regardless of physical status (2026-08-31 fix — "Що зроблено" must only show units actually closed into payroll); a CONSUMED-but-unconfirmed unit stays in IN_PROGRESS instead of vanishing from both buckets', async () => {
      mockProductionOrdersFindMany([{ id: 'po-sub', customerOrderItemId: null, subAssemblyForItemId: 'item1', assemblyId: 'a-sub' }]);
      prisma.tenant.assembly.findMany.mockResolvedValue([{ id: 'a-sub', name: 'Sub Assembly', article: 'S-1' }]);
      prisma.tenant.finishedGood.groupBy.mockImplementation(({ where }: any) => {
        const isReady = where.confirmedByExecutionId !== null;
        // The CONSUMED-but-unconfirmed unit belongs to IN_PROGRESS now, not READY.
        return Promise.resolve(isReady ? [] : [{ assemblyId: 'a-sub', _count: { _all: 1 } }]);
      });

      const result = await service.getOrderProductionUnits(user, 'co1');

      expect(result.ready).toEqual([]);
      expect(result.inProgress).toEqual([{ assemblyId: 'a-sub', assemblyName: 'Sub Assembly', article: 'S-1', qty: 1 }]);
    });

    it('returns empty buckets, without querying FinishedGood at all, when the order has no production batches yet', async () => {
      mockProductionOrdersFindMany([]);
      const result = await service.getOrderProductionUnits(user, 'co1');
      expect(result).toEqual({ inProgress: [], ready: [] });
      expect(prisma.tenant.finishedGood.groupBy).not.toHaveBeenCalled();
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
