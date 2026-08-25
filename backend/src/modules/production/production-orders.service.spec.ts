import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ProductionOrdersService } from './production-orders.service';

describe('ProductionOrdersService', () => {
  let service: ProductionOrdersService;
  let prisma: any;
  let audit: any;
  let stock: any;
  let stockReservationService: any;
  let finishedGoodsService: any;
  let productionExecutionsService: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  const baseOrder = {
    id: 'po1',
    assemblyId: 'a1',
    assemblyVersionId: 'v1',
    unitsPlanned: 2,
    status: 'PLANNED',
    currentStageIndex: null,
  };

  beforeEach(() => {
    prisma = {
      tenant: {
        assembly: { findUnique: jest.fn() },
        assemblyVersion: { findFirst: jest.fn(), findUnique: jest.fn() },
        productionOrder: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn(), count: jest.fn(), delete: jest.fn() },
        productionOrderWorker: { createMany: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
        product: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
        warehouseStock: { findUnique: jest.fn().mockResolvedValue(null) },
        customerOrderItem: { findUnique: jest.fn() },
        finishedGood: { count: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn(), createMany: jest.fn(), deleteMany: jest.fn() },
        productionOrderPickListItem: { createMany: jest.fn(), deleteMany: jest.fn() },
        payrollEntry: { createMany: jest.fn() },
        productionStage: { findMany: jest.fn().mockResolvedValue([]) },
        productionOrderStageEvent: { create: jest.fn(), deleteMany: jest.fn() },
        productionExecution: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
        stockMovement: { findMany: jest.fn().mockResolvedValue([]) },
        warehouse: { findFirst: jest.fn().mockResolvedValue({ id: 'wDefault', isDefault: true }) },
      },
    };
    audit = { record: jest.fn() };
    stock = { applyMovement: jest.fn().mockResolvedValue({ id: 'mv1' }) };
    stockReservationService = {
      getReservedForOrder: jest.fn().mockResolvedValue({ fromStock: 0, fromPurchase: 0 }),
      consume: jest.fn().mockResolvedValue(0),
    };
    finishedGoodsService = { generateSerialNumbers: jest.fn().mockResolvedValue(['SN-000001', 'SN-000002']) };
    productionExecutionsService = { remove: jest.fn().mockResolvedValue(undefined), void_: jest.fn().mockResolvedValue(undefined) };
    service = new ProductionOrdersService(prisma, audit, stock, stockReservationService, finishedGoodsService, productionExecutionsService);

    // findOne() default plumbing for most tests
    prisma.tenant.productionOrder.findUnique.mockResolvedValue({ ...baseOrder });
  });

  describe('create', () => {
    it('rejects when the assembly does not exist', async () => {
      prisma.tenant.assembly.findUnique.mockResolvedValue(null);
      await expect(service.create(user, { assemblyId: 'a1', unitsPlanned: 1 })).rejects.toThrow(NotFoundException);
    });

    it('rejects when the assembly has no saved BOM version yet', async () => {
      prisma.tenant.assembly.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.tenant.assemblyVersion.findFirst.mockResolvedValue(null);
      await expect(service.create(user, { assemblyId: 'a1', unitsPlanned: 1 })).rejects.toThrow(BadRequestException);
    });

    it('locks in the latest AssemblyVersion at creation time', async () => {
      prisma.tenant.assembly.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.tenant.assemblyVersion.findFirst.mockResolvedValue({ id: 'v7', versionNumber: 7 });
      prisma.tenant.productionOrder.create.mockResolvedValue({ ...baseOrder, assemblyVersionId: 'v7' });

      await service.create(user, { assemblyId: 'a1', unitsPlanned: 3 });

      expect(prisma.tenant.productionOrder.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ assemblyId: 'a1', assemblyVersionId: 'v7', unitsPlanned: 3, status: 'PLANNED' }),
      });
    });

    it('writes normalized worker rows when given', async () => {
      prisma.tenant.assembly.findUnique.mockResolvedValue({ id: 'a1' });
      prisma.tenant.assemblyVersion.findFirst.mockResolvedValue({ id: 'v1' });
      prisma.tenant.productionOrder.create.mockResolvedValue({ ...baseOrder });

      await service.create(user, {
        assemblyId: 'a1',
        unitsPlanned: 1,
        workers: [{ employeeId: 'e1', percent: 60 }, { employeeId: 'e2', percent: 40 }],
      });

      expect(prisma.tenant.productionOrderWorker.createMany).toHaveBeenCalledWith({
        data: [{ productionOrderId: 'po1', employeeId: 'e1', percent: 60 }, { productionOrderId: 'po1', employeeId: 'e2', percent: 40 }],
      });
    });
  });

  describe('cancel', () => {
    it('rejects a non-PLANNED order', async () => {
      prisma.tenant.productionOrder.findUnique.mockResolvedValue({ ...baseOrder, status: 'IN_PROGRESS' });
      await expect(service.cancel(user, 'po1')).rejects.toThrow(BadRequestException);
    });

    it('cancels a PLANNED order', async () => {
      prisma.tenant.productionOrder.update.mockResolvedValue({ ...baseOrder, status: 'CANCELLED' });
      const result = await service.cancel(user, 'po1');
      expect(result.status).toBe('CANCELLED');
    });
  });

  describe('remove', () => {
    it('deletes a PLANNED order', async () => {
      await service.remove(user, 'po1');
      expect(prisma.tenant.productionOrder.delete).toHaveBeenCalledWith({ where: { id: 'po1' } });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'production_order.deleted', entityId: 'po1' }));
    });

    it('deletes a CANCELLED order', async () => {
      prisma.tenant.productionOrder.findUnique.mockResolvedValue({ ...baseOrder, status: 'CANCELLED' });
      await service.remove(user, 'po1');
      expect(prisma.tenant.productionOrder.delete).toHaveBeenCalledWith({ where: { id: 'po1' } });
    });

    it('blocks deleting an IN_PROGRESS order, without touching the row', async () => {
      prisma.tenant.productionOrder.findUnique.mockResolvedValue({ ...baseOrder, status: 'IN_PROGRESS' });
      await expect(service.remove(user, 'po1')).rejects.toThrow(ConflictException);
      expect(prisma.tenant.productionOrder.delete).not.toHaveBeenCalled();
    });

    it('blocks deleting a COMPLETED order, without touching the row', async () => {
      prisma.tenant.productionOrder.findUnique.mockResolvedValue({ ...baseOrder, status: 'COMPLETED' });
      await expect(service.remove(user, 'po1')).rejects.toThrow(ConflictException);
      expect(prisma.tenant.productionOrder.delete).not.toHaveBeenCalled();
    });

    it('real incident (2026-08-25): blocks deleting a reverted-to-PLANNED order that still has VOIDED execution history, since ProductionExecution.productionOrder has no onDelete: SetNull', async () => {
      prisma.tenant.productionExecution.count.mockResolvedValue(1);
      await expect(service.remove(user, 'po1')).rejects.toThrow(ConflictException);
      expect(prisma.tenant.productionOrder.delete).not.toHaveBeenCalled();
    });
  });

  describe('revertStart', () => {
    const startedOrder = {
      ...baseOrder,
      status: 'IN_PROGRESS',
      customerOrderItemId: null,
      pickListItems: [
        { productId: 'p1', subAssemblyId: null, consumedFinishedGoodIds: [] },
        { productId: null, subAssemblyId: 'sub1', consumedFinishedGoodIds: ['fg1', 'fg2'] },
      ],
    };

    it('rejects a non-IN_PROGRESS order', async () => {
      prisma.tenant.productionOrder.findUnique.mockResolvedValue({ ...baseOrder, status: 'PLANNED' });
      await expect(service.revertStart(user, 'po1')).rejects.toThrow(BadRequestException);
    });

    it('blocks when this order\'s own output has already been shipped/consumed/QC-checked elsewhere', async () => {
      prisma.tenant.productionOrder.findUnique.mockResolvedValue(startedOrder);
      prisma.tenant.finishedGood.findMany.mockResolvedValue([
        { id: 'out1', serialNumber: 'SN-000001', status: 'SHIPPED', customerOrderId: null, qcChecks: [] },
      ]);
      await expect(service.revertStart(user, 'po1')).rejects.toThrow(ConflictException);
      expect(prisma.tenant.finishedGood.deleteMany).not.toHaveBeenCalled();
    });

    it('reverses stock, sub-assembly consumption, output goods, and DRAFT/CONFIRMED executions, then resets the order to PLANNED', async () => {
      prisma.tenant.productionOrder.findUnique.mockResolvedValue(startedOrder);
      prisma.tenant.finishedGood.findMany.mockResolvedValue([
        { id: 'out1', serialNumber: 'SN-000001', status: 'IN_STOCK', customerOrderId: null, qcChecks: [] },
      ]);
      prisma.tenant.stockMovement.findMany.mockResolvedValue([
        { productId: 'p1', warehouseId: 'wDefault', qtyDelta: -6 },
      ]);
      prisma.tenant.productionExecution.findMany.mockResolvedValue([
        { id: 'exec-draft', status: 'DRAFT' },
        { id: 'exec-confirmed', status: 'CONFIRMED' },
        { id: 'exec-voided', status: 'VOIDED' },
      ]);
      prisma.tenant.productionOrder.update.mockResolvedValue({ ...startedOrder, status: 'PLANNED' });

      await service.revertStart(user, 'po1');

      expect(productionExecutionsService.remove).toHaveBeenCalledWith(user, 'exec-draft');
      expect(productionExecutionsService.void_).toHaveBeenCalledWith(user, 'exec-confirmed', expect.any(Object));
      expect(stock.applyMovement).toHaveBeenCalledWith(
        user,
        expect.objectContaining({ productId: 'p1', warehouseId: 'wDefault', type: 'PRODUCTION_REVERSAL', qtyDelta: 6 }),
      );
      expect(prisma.tenant.finishedGood.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['fg1', 'fg2'] } },
        data: { status: 'IN_STOCK', consumedInProductionOrderId: null },
      });
      expect(prisma.tenant.finishedGood.deleteMany).toHaveBeenCalledWith({ where: { productionOrderId: 'po1' } });
      expect(prisma.tenant.productionOrderPickListItem.deleteMany).toHaveBeenCalledWith({ where: { productionOrderId: 'po1' } });
      // Real incident (2026-08-25): production_order_stage_events is a permanently
      // immutable ledger (REVOKE DELETE FROM app_user, migration 20260805000000) —
      // deleting from it 500'd in production the first time this ran.
      expect(prisma.tenant.productionOrderStageEvent.deleteMany).not.toHaveBeenCalled();
      expect(prisma.tenant.productionOrder.update).toHaveBeenCalledWith({
        where: { id: 'po1' },
        data: expect.objectContaining({ status: 'PLANNED', currentStageIndex: null, laborCostEur: null }),
      });
    });
  });

  describe('start — availability guard', () => {
    beforeEach(() => {
      prisma.tenant.assembly.findUnique.mockResolvedValue({
        id: 'a1', laborCostPerUnit: 0, packagingCostPerUnit: 0, deliveryCostPerUnit: 0, otherCostPerUnit: 0,
      });
    });

    it('rejects a PRODUCT line with insufficient stock, without consuming anything', async () => {
      prisma.tenant.assemblyVersion.findUnique.mockResolvedValue({
        id: 'v1',
        components: [{ componentType: 'PRODUCT', productId: 'p1', qtyPerUnit: 10 }],
      });
      prisma.tenant.warehouseStock.findUnique.mockResolvedValue({ qty: 5, reservedQty: 0 });

      await expect(service.start(user, 'po1', {})).rejects.toThrow(BadRequestException);
      expect(stock.applyMovement).not.toHaveBeenCalled();
    });

    it('rejects a PRODUCT line whose physical stock is enough but is already reserved by another order', async () => {
      prisma.tenant.assemblyVersion.findUnique.mockResolvedValue({
        id: 'v1',
        components: [{ componentType: 'PRODUCT', productId: 'p1', qtyPerUnit: 10 }],
      });
      // needed = 20; physical = 25 but 10 already reserved by another order and this batch has no order line of its own => available = 15 < 20
      prisma.tenant.warehouseStock.findUnique.mockResolvedValue({ qty: 25, reservedQty: 10 });

      await expect(service.start(user, 'po1', {})).rejects.toThrow(BadRequestException);
      expect(stock.applyMovement).not.toHaveBeenCalled();
    });

    it('rejects an ASSEMBLY line with insufficient IN_STOCK finished goods', async () => {
      prisma.tenant.assemblyVersion.findUnique.mockResolvedValue({
        id: 'v1',
        components: [{ componentType: 'ASSEMBLY', subAssemblyId: 'sub1', qtyPerUnit: 1 }],
      });
      prisma.tenant.finishedGood.count.mockResolvedValue(1); // need 2 (unitsPlanned=2 * qtyPerUnit=1), only 1 available

      await expect(service.start(user, 'po1', {})).rejects.toThrow(BadRequestException);
      expect(stock.applyMovement).not.toHaveBeenCalled();
    });

    it('rejects starting an order that is not PLANNED', async () => {
      prisma.tenant.productionOrder.findUnique.mockResolvedValue({ ...baseOrder, status: 'COMPLETED' });
      await expect(service.start(user, 'po1', {})).rejects.toThrow(BadRequestException);
    });
  });

  describe('start — consumption, cost freezing, FinishedGoods, payroll, stage entry', () => {
    beforeEach(() => {
      prisma.tenant.assembly.findUnique.mockResolvedValue({
        id: 'a1', laborCostPerUnit: 10, packagingCostPerUnit: 2, deliveryCostPerUnit: 1, otherCostPerUnit: 0,
      });
      prisma.tenant.assemblyVersion.findUnique.mockResolvedValue({
        id: 'v1',
        components: [
          { componentType: 'PRODUCT', productId: 'p1', qtyPerUnit: 3 },
          { componentType: 'ASSEMBLY', subAssemblyId: 'sub1', qtyPerUnit: 1 },
        ],
      });
      prisma.tenant.warehouseStock.findUnique.mockResolvedValue({ qty: 100, reservedQty: 0 });
      // Product pricing consolidated to one field, sellPriceEur (see
      // purchase-orders.service.ts#receive's own actualPrice-writeback
      // comment) — the real cost-freezing code reads that single field for
      // both materialsLocalCost and materialsGermanCost on a PRODUCT line
      // (there is no separate per-line German product price), not the
      // legacy localPriceExclVat/germanPriceExclVat pair.
      prisma.tenant.product.findUniqueOrThrow.mockResolvedValue({ sellPriceEur: 5, article: 'ABC', name: 'Widget part' });
      prisma.tenant.finishedGood.count.mockResolvedValue(5); // enough sub1 units in stock (need 2)
      prisma.tenant.finishedGood.findMany.mockResolvedValue([
        { id: 'fg-old-1', unitCostLocalEur: 20, unitCostGermanEur: 25, manufactureDate: new Date('2026-01-01') },
        { id: 'fg-old-2', unitCostLocalEur: 22, unitCostGermanEur: 27, manufactureDate: new Date('2026-01-02') },
      ]);
      prisma.tenant.assembly.findUnique.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.id === 'sub1'
            ? { id: 'sub1', name: 'Sub-assembly' }
            : { id: 'a1', laborCostPerUnit: 10, packagingCostPerUnit: 2, deliveryCostPerUnit: 1, otherCostPerUnit: 0 },
        ),
      );
      prisma.tenant.productionOrder.update.mockImplementation(({ data }: any) => Promise.resolve({ ...baseOrder, ...data }));
    });

    it('consumes PRODUCT lines through StockService with PRODUCTION_CONSUMPTION and the resolved default warehouse', async () => {
      await service.start(user, 'po1', {});

      expect(stock.applyMovement).toHaveBeenCalledWith(
        user,
        expect.objectContaining({
          productId: 'p1',
          warehouseId: 'wDefault',
          type: 'PRODUCTION_CONSUMPTION',
          qtyDelta: -6, // unitsPlanned(2) * qtyPerUnit(3)
          sourceType: 'ProductionOrder',
          sourceId: 'po1',
        }),
      );
    });

    it('FIFO-consumes the oldest IN_STOCK finished goods for an ASSEMBLY line and marks them CONSUMED', async () => {
      await service.start(user, 'po1', {});

      expect(prisma.tenant.finishedGood.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { assemblyId: 'sub1', status: 'IN_STOCK' }, orderBy: { manufactureDate: 'asc' }, take: 2 }),
      );
      expect(prisma.tenant.finishedGood.update).toHaveBeenCalledWith({
        where: { id: 'fg-old-1' },
        data: { status: 'CONSUMED', consumedInProductionOrderId: 'po1' },
      });
      expect(prisma.tenant.finishedGood.update).toHaveBeenCalledWith({
        where: { id: 'fg-old-2' },
        data: { status: 'CONSUMED', consumedInProductionOrderId: 'po1' },
      });
    });

    it('freezes total cost = materials (product + consumed sub-assembly cost) + own labor/packaging/delivery/other, and completes immediately when no stages are configured', async () => {
      await service.start(user, 'po1', {});

      // materials local: 6 * 5 (product) + (20 + 22) (consumed sub1 units) = 30 + 42 = 72
      // own: labor 10*2=20, packaging 2*2=4, delivery 1*2=2, other 0 => 26
      // total local = 98
      expect(prisma.tenant.productionOrder.update).toHaveBeenCalledWith({
        where: { id: 'po1' },
        data: expect.objectContaining({
          status: 'COMPLETED',
          currentStageIndex: null,
          totalLocalCostEur: 98,
          laborCostEur: 20,
          packagingCostEur: 4,
          deliveryCostEur: 2,
          otherCostEur: 0,
          fullCostEur: 98,
        }),
      });
    });

    it('enters stage tracking at index 0 when stages are configured, instead of completing', async () => {
      prisma.tenant.productionStage.findMany.mockResolvedValue([{ id: 's1', sortOrder: 0 }, { id: 's2', sortOrder: 1 }]);

      await service.start(user, 'po1', {});

      expect(prisma.tenant.productionOrder.update).toHaveBeenCalledWith({
        where: { id: 'po1' },
        data: expect.objectContaining({ status: 'IN_PROGRESS', currentStageIndex: 0, completedAt: null }),
      });
    });

    it('generates one FinishedGood per planned unit with the frozen per-unit cost', async () => {
      await service.start(user, 'po1', {});

      expect(finishedGoodsService.generateSerialNumbers).toHaveBeenCalledWith('c1', 2);
      expect(prisma.tenant.finishedGood.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ serialNumber: 'SN-000001', assemblyId: 'a1', productionOrderId: 'po1', status: 'IN_STOCK', unitCostLocalEur: 49 }),
          expect.objectContaining({ serialNumber: 'SN-000002', assemblyId: 'a1', productionOrderId: 'po1', status: 'IN_STOCK', unitCostLocalEur: 49 }),
        ],
      });
    });

    it('production-labor module (2026-08-24): never touches PayrollEntry at start() any more, worker assignments or not — piecework is now generated only by ProductionExecutionsService#confirm', async () => {
      prisma.tenant.productionOrderWorker.findMany.mockResolvedValue([
        { employeeId: 'e1', percent: 60 },
        { employeeId: 'e2', percent: 40 },
      ]);

      await service.start(user, 'po1', {});

      expect(prisma.tenant.payrollEntry.createMany).not.toHaveBeenCalled();
    });

    it('§14/§16: a batch linked to a customer order closes out THAT ORDER\'s own reservation (shared pool, order-level not line-level) as material is consumed', async () => {
      prisma.tenant.productionOrder.findUnique.mockResolvedValue({ ...baseOrder, customerOrderItemId: 'item1' });
      prisma.tenant.customerOrderItem.findUnique.mockResolvedValue({ id: 'item1', customerOrderId: 'co1' });
      // needed = 6 (unitsPlanned 2 * qtyPerUnit 3); order had reserved 4 from stock, 0 from purchase
      stockReservationService.getReservedForOrder.mockResolvedValue({ fromStock: 4, fromPurchase: 0 });

      await service.start(user, 'po1', {});

      expect(stockReservationService.getReservedForOrder).toHaveBeenCalledWith(user, 'co1', 'p1', 'wDefault');
      expect(stockReservationService.consume).toHaveBeenCalledWith(user, { productId: 'p1', warehouseId: 'wDefault', customerOrderId: 'co1', source: 'STOCK' }, 4);
      // remaining 2 of the 6 needed comes from ordinary available stock — no PURCHASE-source consume call since fromPurchase was 0
      expect(stockReservationService.consume).not.toHaveBeenCalledWith(user, expect.objectContaining({ source: 'PURCHASE' }), expect.anything());
    });

    it('an ad-hoc batch with no linked customer order never touches any reservation', async () => {
      await service.start(user, 'po1', {}); // baseOrder has no customerOrderItemId
      expect(stockReservationService.getReservedForOrder).not.toHaveBeenCalled();
      expect(stockReservationService.consume).not.toHaveBeenCalled();
    });
  });

  describe('advanceStage', () => {
    it('rejects an order that is not IN_PROGRESS', async () => {
      prisma.tenant.productionOrder.findUnique.mockResolvedValue({ ...baseOrder, status: 'PLANNED', currentStageIndex: null });
      await expect(service.advanceStage(user, 'po1')).rejects.toThrow(BadRequestException);
    });

    it('records a stage event and advances currentStageIndex when more stages remain', async () => {
      prisma.tenant.productionOrder.findUnique.mockResolvedValue({ ...baseOrder, status: 'IN_PROGRESS', currentStageIndex: 0 });
      prisma.tenant.productionStage.findMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
      prisma.tenant.productionOrder.update.mockResolvedValue({ ...baseOrder, status: 'IN_PROGRESS', currentStageIndex: 1 });

      const result = await service.advanceStage(user, 'po1');

      expect(prisma.tenant.productionOrderStageEvent.create).toHaveBeenCalledWith({
        data: { productionOrderId: 'po1', stageIndex: 0, actorUserId: 'u1' },
      });
      expect(prisma.tenant.productionOrder.update).toHaveBeenCalledWith({
        where: { id: 'po1' },
        data: { currentStageIndex: 1 },
      });
      expect(result.currentStageIndex).toBe(1);
    });

    it('auto-completes when advancing past the last configured stage', async () => {
      prisma.tenant.productionOrder.findUnique.mockResolvedValue({ ...baseOrder, status: 'IN_PROGRESS', currentStageIndex: 1 });
      prisma.tenant.productionStage.findMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
      prisma.tenant.productionOrder.update.mockResolvedValue({ ...baseOrder, status: 'COMPLETED', currentStageIndex: null });

      await service.advanceStage(user, 'po1');

      expect(prisma.tenant.productionOrder.update).toHaveBeenCalledWith({
        where: { id: 'po1' },
        data: { status: 'COMPLETED', currentStageIndex: null, completedAt: expect.any(Date) },
      });
    });

    it('throws if IN_PROGRESS but no stages are configured (data inconsistency)', async () => {
      prisma.tenant.productionOrder.findUnique.mockResolvedValue({ ...baseOrder, status: 'IN_PROGRESS', currentStageIndex: 0 });
      prisma.tenant.productionStage.findMany.mockResolvedValue([]);
      await expect(service.advanceStage(user, 'po1')).rejects.toThrow(ConflictException);
    });
  });
});
