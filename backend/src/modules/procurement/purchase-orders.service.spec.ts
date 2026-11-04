import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';

describe('PurchaseOrdersService', () => {
  let service: PurchaseOrdersService;
  let prisma: any;
  let audit: any;
  let stock: any;
  let supplierCatalogService: any;
  let deliverySchedulesService: any;
  let finishedGoodsService: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  const order = {
    id: 'po1',
    status: 'ORDERED',
    supplierNameSnapshot: 'Acme Supplies',
    items: [
      { id: 'item1', productId: 'p1', articleSnapshot: 'ABC', qtyOrdered: 10, qtyReceived: 0 },
      { id: 'item2', productId: null, articleSnapshot: 'XYZ (no product yet)', qtyOrdered: 5, qtyReceived: 0 },
    ],
  };

  beforeEach(() => {
    prisma = {
      tenant: {
        purchaseOrder: { create: jest.fn(), findUnique: jest.fn().mockResolvedValue({ ...order }), findMany: jest.fn().mockResolvedValue([]), count: jest.fn(), update: jest.fn(), delete: jest.fn() },
        purchaseOrderItem: { update: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
        purchaseOrderDocument: { count: jest.fn().mockResolvedValue(0) },
        purchaseOrderExpense: { count: jest.fn().mockResolvedValue(0) },
        warehouse: { findFirst: jest.fn().mockResolvedValue({ id: 'wDefault', isDefault: true }) },
        orderMaterialRequirement: { findUnique: jest.fn() },
        // receive() writes actualPrice back onto Product.sellPriceEur when
        // given (ProductsService#setSuppliers's default-supplier price).
        product: { update: jest.fn() },
      },
    };
    audit = { record: jest.fn() };
    stock = { applyMovement: jest.fn().mockResolvedValue({ id: 'mv1' }) };
    deliverySchedulesService = {} as any;
    const comments = {} as any;
    const exchangeRatesService: any = { convert: jest.fn((amount: number) => Promise.resolve(amount)), getBaseCurrency: jest.fn().mockResolvedValue('EUR') };
    supplierCatalogService = { ensureCatalogEntries: jest.fn().mockResolvedValue(undefined) };
    finishedGoodsService = { receivePurchased: jest.fn().mockResolvedValue([{ id: 'fg1' }]) };
    service = new PurchaseOrdersService(
      prisma,
      audit,
      stock,
      deliverySchedulesService,
      comments,
      exchangeRatesService,
      supplierCatalogService,
      finishedGoodsService,
    );
  });

  describe('create', () => {
    it('creates the order with nested items and status ORDERED', async () => {
      prisma.tenant.purchaseOrder.create.mockResolvedValue({ id: 'po1', status: 'ORDERED', items: [] });

      await service.create(user, {
        supplierNameSnapshot: 'Acme Supplies',
        items: [{ articleSnapshot: 'ABC', productNameSnapshot: 'Widget', qtyOrdered: 10 }],
      });

      expect(prisma.tenant.purchaseOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            supplierNameSnapshot: 'Acme Supplies',
            status: 'ORDERED',
            createdById: 'u1',
            items: { create: [expect.objectContaining({ articleSnapshot: 'ABC', qtyOrdered: 10 })] },
          }),
        }),
      );
    });

    it("ensures supplier-catalog entries for the new order's own supplierId/productIds/assemblyIds", async () => {
      prisma.tenant.purchaseOrder.create.mockResolvedValue({
        id: 'po1',
        status: 'ORDERED',
        supplierId: 's1',
        items: [
          { productId: 'p1', assemblyId: null },
          { productId: null, assemblyId: 'a1' },
        ],
      });

      await service.create(user, {
        supplierId: 's1',
        supplierNameSnapshot: 'Acme Supplies',
        items: [{ articleSnapshot: 'ABC', productNameSnapshot: 'Widget', qtyOrdered: 10 }],
      } as any);

      expect(supplierCatalogService.ensureCatalogEntries).toHaveBeenCalledWith(user, 's1', ['p1', null], [null, 'a1']);
    });

    it('passes assemblyId through for a виріб line', async () => {
      prisma.tenant.purchaseOrder.create.mockResolvedValue({ id: 'po1', status: 'ORDERED', items: [] });

      await service.create(user, {
        supplierNameSnapshot: 'Acme Supplies',
        items: [{ assemblyId: 'a1', articleSnapshot: 'ASM-1', productNameSnapshot: 'Sub-assembly', qtyOrdered: 3 }],
      } as any);

      expect(prisma.tenant.purchaseOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            items: { create: [expect.objectContaining({ assemblyId: 'a1', articleSnapshot: 'ASM-1', qtyOrdered: 3 })] },
          }),
        }),
      );
    });
  });

  describe('getDeliveryScheduleSiblings', () => {
    it('returns an empty array for an item with no originating заявка line', async () => {
      prisma.tenant.purchaseOrderItem.findUnique.mockResolvedValue({ id: 'item1', originatingPurchaseRequestItemId: null });
      const result = await service.getDeliveryScheduleSiblings(user, 'item1');
      expect(result).toEqual([]);
      expect(prisma.tenant.purchaseOrderItem.findMany).not.toHaveBeenCalled();
    });

    it('rejects an unknown item id', async () => {
      prisma.tenant.purchaseOrderItem.findUnique.mockResolvedValue(null);
      await expect(service.getDeliveryScheduleSiblings(user, 'nope')).rejects.toThrow(NotFoundException);
    });

    it('returns every sibling sharing the same originatingPurchaseRequestItemId, with its customer order number/deadline', async () => {
      prisma.tenant.purchaseOrderItem.findUnique.mockResolvedValue({ id: 'item1', originatingPurchaseRequestItemId: 'pri1' });
      prisma.tenant.purchaseOrderItem.findMany.mockResolvedValue([
        {
          id: 'item1',
          purchaseOrderId: 'po1',
          productId: 'p1',
          articleSnapshot: 'ABC',
          productNameSnapshot: 'Widget',
          qtyOrdered: 6,
          currentDeliveryScheduleId: null,
          purchaseOrder: { sourceCustomerOrderId: 'co1', sourceCustomerOrder: { orderNumber: '1001', deadline: new Date('2026-12-01') } },
        },
        {
          id: 'item2',
          purchaseOrderId: 'po2',
          productId: 'p1',
          articleSnapshot: 'ABC',
          productNameSnapshot: 'Widget',
          qtyOrdered: 4,
          currentDeliveryScheduleId: null,
          purchaseOrder: { sourceCustomerOrderId: 'co2', sourceCustomerOrder: { orderNumber: '1002', deadline: new Date('2026-11-15') } },
        },
      ]);

      const result = await service.getDeliveryScheduleSiblings(user, 'item1');

      expect(prisma.tenant.purchaseOrderItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { originatingPurchaseRequestItemId: 'pri1' } }),
      );
      expect(result).toEqual([
        expect.objectContaining({ id: 'item1', customerOrderId: 'co1', customerOrderNumber: '1001' }),
        expect.objectContaining({ id: 'item2', customerOrderId: 'co2', customerOrderNumber: '1002' }),
      ]);
    });
  });

  describe('createGroupedDeliverySchedule', () => {
    const groupItems = [
      { id: 'item1', purchaseOrderId: 'po1', qtyOrdered: 6 },
      { id: 'item2', purchaseOrderId: 'po2', qtyOrdered: 4 },
    ];

    beforeEach(() => {
      prisma.tenant.purchaseOrderItem.findMany.mockResolvedValue(groupItems);
      prisma.tenant.purchaseOrder.findMany.mockResolvedValue([
        { id: 'po1', sourceCustomerOrder: { deadline: new Date('2026-12-01') } },
        { id: 'po2', sourceCustomerOrder: { deadline: new Date('2026-11-15') } },
      ]);
      deliverySchedulesService.createFirstVersion = jest.fn().mockResolvedValue({ id: 'sched1' });
    });

    it('rejects when one of the submitted item ids does not exist', async () => {
      prisma.tenant.purchaseOrderItem.findMany.mockResolvedValue([groupItems[0]]);
      await expect(
        service.createGroupedDeliverySchedule(user, { purchaseOrderItemIds: ['item1', 'item2'], lines: [{ date: new Date(), qty: 10 }] }),
      ).rejects.toThrow(NotFoundException);
    });

    it("splits each line's qty proportionally to each item's own qtyOrdered share, earliest-deadline item absorbing the remainder", async () => {
      await service.createGroupedDeliverySchedule(user, {
        purchaseOrderItemIds: ['item1', 'item2'],
        lines: [{ date: new Date('2026-11-20'), qty: 10 }],
      });

      expect(deliverySchedulesService.createFirstVersion).toHaveBeenCalledWith('c1', 'u1', 'item1', [{ date: new Date('2026-11-20'), qty: 6 }]);
      // po2's order deadline (2026-11-15) is earlier/more urgent than po1's (2026-12-01) — item2 absorbs the rounding remainder.
      expect(deliverySchedulesService.createFirstVersion).toHaveBeenCalledWith('c1', 'u1', 'item2', [{ date: new Date('2026-11-20'), qty: 4 }]);
    });

    it('skips an item whose proportional share rounds to zero rather than creating an empty schedule', async () => {
      prisma.tenant.purchaseOrderItem.findMany.mockResolvedValue([
        { id: 'item1', purchaseOrderId: 'po1', qtyOrdered: 1000 },
        { id: 'item2', purchaseOrderId: 'po2', qtyOrdered: 0.0001 },
      ]);
      await service.createGroupedDeliverySchedule(user, {
        purchaseOrderItemIds: ['item1', 'item2'],
        lines: [{ date: new Date('2026-11-20'), qty: 1 }],
      });
      expect(deliverySchedulesService.createFirstVersion).toHaveBeenCalledTimes(1);
      expect(deliverySchedulesService.createFirstVersion).toHaveBeenCalledWith('c1', 'u1', 'item1', expect.anything());
    });
  });

  describe('receive', () => {
    it('rejects receiving against an already-DELIVERED order', async () => {
      prisma.tenant.purchaseOrder.findUnique.mockResolvedValue({ ...order, status: 'DELIVERED' });
      await expect(
        service.receive(user, 'po1', { lines: [{ purchaseOrderItemId: 'item1', qtyReceived: 1 }] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a line referencing an item that does not belong to this order', async () => {
      await expect(
        service.receive(user, 'po1', { lines: [{ purchaseOrderItemId: 'not-in-this-order', qtyReceived: 1 }] }),
      ).rejects.toThrow(NotFoundException);
    });

    it('posts a RECEIVE stock movement only for lines with a linked product', async () => {
      prisma.tenant.purchaseOrderItem.findMany.mockResolvedValue([
        { id: 'item1', productId: 'p1', qtyOrdered: 10, qtyReceived: 4 },
        { id: 'item2', productId: null, qtyOrdered: 5, qtyReceived: 5 },
      ]);
      prisma.tenant.purchaseOrder.update.mockResolvedValue({ id: 'po1', status: 'PARTIAL', items: [] });

      await service.receive(user, 'po1', {
        lines: [
          { purchaseOrderItemId: 'item1', qtyReceived: 4 },
          { purchaseOrderItemId: 'item2', qtyReceived: 5 },
        ],
      });

      expect(stock.applyMovement).toHaveBeenCalledTimes(1);
      expect(stock.applyMovement).toHaveBeenCalledWith(
        user,
        expect.objectContaining({ productId: 'p1', warehouseId: 'wDefault', type: 'RECEIVE', qtyDelta: 4, sourceType: 'PurchaseOrder', sourceId: 'po1' }),
      );
      expect(prisma.tenant.purchaseOrderItem.update).toHaveBeenCalledWith({
        where: { id: 'item1' },
        data: { qtyReceived: { increment: 4 } },
      });
      expect(prisma.tenant.purchaseOrderItem.update).toHaveBeenCalledWith({
        where: { id: 'item2' },
        data: { qtyReceived: { increment: 5 } },
      });
    });

    it('records actualPrice when given', async () => {
      prisma.tenant.purchaseOrderItem.findMany.mockResolvedValue([
        { id: 'item1', productId: 'p1', qtyOrdered: 10, qtyReceived: 4 },
        { id: 'item2', productId: null, qtyOrdered: 5, qtyReceived: 0 },
      ]);
      prisma.tenant.purchaseOrder.update.mockResolvedValue({ id: 'po1', status: 'PARTIAL', items: [] });

      await service.receive(user, 'po1', {
        lines: [{ purchaseOrderItemId: 'item1', qtyReceived: 4, actualPrice: 12.5 }],
      });

      expect(prisma.tenant.purchaseOrderItem.update).toHaveBeenCalledWith({
        where: { id: 'item1' },
        data: { qtyReceived: { increment: 4 }, actualPrice: 12.5 },
      });
    });

    it('sets status to PARTIAL when some but not all items are fully received', async () => {
      prisma.tenant.purchaseOrderItem.findMany.mockResolvedValue([
        { id: 'item1', productId: 'p1', qtyOrdered: 10, qtyReceived: 4 },
        { id: 'item2', productId: null, qtyOrdered: 5, qtyReceived: 0 },
      ]);
      prisma.tenant.purchaseOrder.update.mockResolvedValue({ id: 'po1', status: 'PARTIAL', items: [] });

      await service.receive(user, 'po1', { lines: [{ purchaseOrderItemId: 'item1', qtyReceived: 4 }] });

      expect(prisma.tenant.purchaseOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'po1' }, data: { status: 'PARTIAL' } }),
      );
    });

    it('sets status to DELIVERED when every item is fully received', async () => {
      prisma.tenant.purchaseOrderItem.findMany.mockResolvedValue([
        { id: 'item1', productId: 'p1', qtyOrdered: 10, qtyReceived: 10 },
        { id: 'item2', productId: null, qtyOrdered: 5, qtyReceived: 5 },
      ]);
      prisma.tenant.purchaseOrder.update.mockResolvedValue({ id: 'po1', status: 'DELIVERED', items: [] });

      await service.receive(user, 'po1', { lines: [{ purchaseOrderItemId: 'item1', qtyReceived: 10 }] });

      expect(prisma.tenant.purchaseOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'po1' }, data: { status: 'DELIVERED' } }),
      );
    });

    it('§ simplified spec: resolves preferredOrderId from the line\'s sourceRequirementId and passes it through to applyMovement, so that order is topped up first (StockService#applyMovement owns the actual reservation logic)', async () => {
      prisma.tenant.purchaseOrderItem.findMany.mockResolvedValue([
        { id: 'item1', productId: 'p1', qtyOrdered: 15, qtyReceived: 15, sourceRequirementId: 'req1' },
        { id: 'item2', productId: null, qtyOrdered: 5, qtyReceived: 0 },
      ]);
      prisma.tenant.purchaseOrder.findUnique.mockResolvedValue({
        ...order,
        items: [{ id: 'item1', productId: 'p1', articleSnapshot: 'ABC', qtyOrdered: 15, qtyReceived: 0, sourceRequirementId: 'req1' }, order.items[1]],
      });
      prisma.tenant.purchaseOrder.update.mockResolvedValue({ id: 'po1', status: 'PARTIAL', items: [] });
      prisma.tenant.orderMaterialRequirement.findUnique.mockResolvedValue({ id: 'req1', customerOrderId: 'co1' });

      await service.receive(user, 'po1', { lines: [{ purchaseOrderItemId: 'item1', qtyReceived: 15 }] });

      expect(prisma.tenant.orderMaterialRequirement.findUnique).toHaveBeenCalledWith({ where: { id: 'req1' } });
      expect(stock.applyMovement).toHaveBeenCalledWith(
        user,
        expect.objectContaining({ productId: 'p1', warehouseId: 'wDefault', type: 'RECEIVE', qtyDelta: 15, preferredOrderId: 'co1' }),
      );
    });

    it('passes preferredOrderId: undefined for a line with no sourceRequirementId', async () => {
      prisma.tenant.purchaseOrderItem.findMany.mockResolvedValue([
        { id: 'item1', productId: 'p1', qtyOrdered: 10, qtyReceived: 4 },
        { id: 'item2', productId: null, qtyOrdered: 5, qtyReceived: 0 },
      ]);
      prisma.tenant.purchaseOrder.update.mockResolvedValue({ id: 'po1', status: 'PARTIAL', items: [] });

      await service.receive(user, 'po1', { lines: [{ purchaseOrderItemId: 'item1', qtyReceived: 4 }] });

      expect(prisma.tenant.orderMaterialRequirement.findUnique).not.toHaveBeenCalled();
      expect(stock.applyMovement).toHaveBeenCalledWith(user, expect.objectContaining({ preferredOrderId: undefined }));
    });

    it('throws if no warehouse is given and none is configured as default', async () => {
      prisma.tenant.warehouse.findFirst.mockResolvedValue(null);
      await expect(
        service.receive(user, 'po1', { lines: [{ purchaseOrderItemId: 'item1', qtyReceived: 1 }] }),
      ).rejects.toThrow(BadRequestException);
    });

    describe('виріб (assembly) lines', () => {
      beforeEach(() => {
        prisma.tenant.purchaseOrder.findUnique.mockResolvedValue({
          ...order,
          items: [{ id: 'item1', productId: null, assemblyId: 'a1', articleSnapshot: 'ASM-1', expectedPrice: 7, qtyOrdered: 3, qtyReceived: 0 }],
        });
        prisma.tenant.purchaseOrderItem.findMany.mockResolvedValue([
          { id: 'item1', productId: null, assemblyId: 'a1', qtyOrdered: 3, qtyReceived: 3 },
        ]);
        prisma.tenant.purchaseOrder.update.mockResolvedValue({ id: 'po1', status: 'DELIVERED', items: [] });
      });

      it('calls FinishedGoodsService#receivePurchased instead of StockService#applyMovement', async () => {
        await service.receive(user, 'po1', { lines: [{ purchaseOrderItemId: 'item1', qtyReceived: 3, actualPrice: 15 }] });

        expect(stock.applyMovement).not.toHaveBeenCalled();
        expect(finishedGoodsService.receivePurchased).toHaveBeenCalledWith(user, {
          assemblyId: 'a1',
          qty: 3,
          unitCostEur: 15,
          comment: expect.stringContaining('Acme Supplies'),
          sourcePurchaseOrderItemId: 'item1',
        });
      });

      it('falls back to the line item\'s expectedPrice when no actualPrice is given', async () => {
        await service.receive(user, 'po1', { lines: [{ purchaseOrderItemId: 'item1', qtyReceived: 3 }] });

        expect(finishedGoodsService.receivePurchased).toHaveBeenCalledWith(user, expect.objectContaining({ unitCostEur: 7 }));
      });

      it('rejects a fractional qty — one FinishedGood row per unit has no meaning otherwise', async () => {
        await expect(
          service.receive(user, 'po1', { lines: [{ purchaseOrderItemId: 'item1', qtyReceived: 2.5 }] }),
        ).rejects.toThrow(BadRequestException);
        expect(finishedGoodsService.receivePurchased).not.toHaveBeenCalled();
      });
    });
  });

  describe('remove', () => {
    it('deletes a purchase order with no recorded finance data', async () => {
      await service.remove(user, 'po1');
      expect(prisma.tenant.purchaseOrder.delete).toHaveBeenCalledWith({ where: { id: 'po1' } });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'purchase_order.deleted', entityId: 'po1' }));
    });

    it('blocks deletion when the order has finance documents, without touching the row', async () => {
      prisma.tenant.purchaseOrderDocument.count.mockResolvedValue(2);
      await expect(service.remove(user, 'po1')).rejects.toThrow(ConflictException);
      expect(prisma.tenant.purchaseOrder.delete).not.toHaveBeenCalled();
    });

    it('blocks deletion when the order has expenses, without touching the row', async () => {
      prisma.tenant.purchaseOrderExpense.count.mockResolvedValue(1);
      await expect(service.remove(user, 'po1')).rejects.toThrow(ConflictException);
      expect(prisma.tenant.purchaseOrder.delete).not.toHaveBeenCalled();
    });
  });
});
