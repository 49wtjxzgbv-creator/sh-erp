import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';

describe('PurchaseOrdersService', () => {
  let service: PurchaseOrdersService;
  let prisma: any;
  let audit: any;
  let stock: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  const order = {
    id: 'po1',
    status: 'ORDERED',
    items: [
      { id: 'item1', productId: 'p1', articleSnapshot: 'ABC', qtyOrdered: 10, qtyReceived: 0 },
      { id: 'item2', productId: null, articleSnapshot: 'XYZ (no product yet)', qtyOrdered: 5, qtyReceived: 0 },
    ],
  };

  beforeEach(() => {
    prisma = {
      tenant: {
        purchaseOrder: { create: jest.fn(), findUnique: jest.fn().mockResolvedValue({ ...order }), findMany: jest.fn(), count: jest.fn(), update: jest.fn() },
        purchaseOrderItem: { update: jest.fn(), findMany: jest.fn() },
        warehouse: { findFirst: jest.fn().mockResolvedValue({ id: 'wDefault', isDefault: true }) },
        orderMaterialRequirement: { findUnique: jest.fn() },
      },
    };
    audit = { record: jest.fn() };
    stock = { applyMovement: jest.fn().mockResolvedValue({ id: 'mv1' }) };
    service = new PurchaseOrdersService(prisma, audit, stock);
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
  });
});
