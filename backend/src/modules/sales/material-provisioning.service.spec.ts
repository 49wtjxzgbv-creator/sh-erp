import { MaterialProvisioningService } from './material-provisioning.service';

describe('MaterialProvisioningService', () => {
  let service: MaterialProvisioningService;
  let prisma: any;
  let audit: any;
  let shortageService: any;
  let stockReservationService: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  const item = { id: 'item1', customerOrderId: 'co1', assemblyId: 'a1', qty: 20 };

  beforeEach(() => {
    prisma = {
      tenant: {
        customerOrderItem: { findUnique: jest.fn().mockResolvedValue(item) },
        product: { findMany: jest.fn().mockResolvedValue([{ id: 'p1', article: 'ABC', name: 'Widget' }]) },
        warehouseStock: { findMany: jest.fn().mockResolvedValue([]) },
        orderMaterialRequirement: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), upsert: jest.fn() },
        stockReservation: { findMany: jest.fn().mockResolvedValue([]) },
        purchaseOrderItem: { findMany: jest.fn().mockResolvedValue([]) },
        warehouse: { findFirst: jest.fn().mockResolvedValue({ id: 'wDefault', isDefault: true }) },
      },
    };
    audit = { record: jest.fn() };
    shortageService = { getProductRequirements: jest.fn().mockResolvedValue(new Map([['p1', 20]])) };
    stockReservationService = { reserveFromStock: jest.fn(), release: jest.fn() };
    service = new MaterialProvisioningService(prisma, audit, shortageService, stockReservationService);
  });

  describe('getItemSummary — §12/§13 status derivation', () => {
    it('NOT_COVERED: no decision made, nothing reserved yet', async () => {
      const [line] = await service.getItemSummary(user, 'co1', 'item1');
      expect(line.requiredQty).toBe(20);
      expect(line.status).toBe('NOT_COVERED');
      expect(line.decision).toBeNull();
    });

    it('PARTIALLY_RESERVED: some reserved from stock, nothing purchased', async () => {
      prisma.tenant.orderMaterialRequirement.findMany.mockResolvedValue([
        { id: 'req1', productId: 'p1', qtyFromStock: 5, qtyToPurchase: 0 },
      ]);
      prisma.tenant.stockReservation.findMany.mockResolvedValue([
        { productId: 'p1', customerOrderItemId: 'item1', source: 'STOCK', qty: 5, consumedQty: 0 },
      ]);

      const [line] = await service.getItemSummary(user, 'co1', 'item1');
      expect(line.reservedFromStockQty).toBe(5);
      expect(line.coveredQty).toBe(5);
      expect(line.uncoveredQty).toBe(15);
      expect(line.status).toBe('PARTIALLY_RESERVED');
    });

    it('AWAITING_PURCHASE: ordered from supplier, nothing received yet', async () => {
      prisma.tenant.orderMaterialRequirement.findMany.mockResolvedValue([
        { id: 'req1', productId: 'p1', qtyFromStock: 0, qtyToPurchase: 20 },
      ]);
      prisma.tenant.purchaseOrderItem.findMany.mockResolvedValue([
        { sourceRequirementId: 'req1', qtyOrdered: 20, qtyReceived: 0 },
      ]);

      const [line] = await service.getItemSummary(user, 'co1', 'item1');
      expect(line.orderedFromSupplierQty).toBe(20);
      expect(line.receivedQty).toBe(0);
      expect(line.status).toBe('AWAITING_PURCHASE');
    });

    it('PARTIALLY_RECEIVED: some of the purchase has arrived', async () => {
      prisma.tenant.orderMaterialRequirement.findMany.mockResolvedValue([
        { id: 'req1', productId: 'p1', qtyFromStock: 0, qtyToPurchase: 20 },
      ]);
      prisma.tenant.purchaseOrderItem.findMany.mockResolvedValue([
        { sourceRequirementId: 'req1', qtyOrdered: 20, qtyReceived: 8 },
      ]);
      prisma.tenant.stockReservation.findMany.mockResolvedValue([
        { productId: 'p1', customerOrderItemId: 'item1', source: 'PURCHASE', qty: 8, consumedQty: 0 },
      ]);

      const [line] = await service.getItemSummary(user, 'co1', 'item1');
      expect(line.stillExpectedQty).toBe(12);
      expect(line.status).toBe('PARTIALLY_RECEIVED');
    });

    it('FULLY_COVERED: reserved (stock + purchase) meets the full requirement', async () => {
      prisma.tenant.orderMaterialRequirement.findMany.mockResolvedValue([
        { id: 'req1', productId: 'p1', qtyFromStock: 5, qtyToPurchase: 15 },
      ]);
      prisma.tenant.purchaseOrderItem.findMany.mockResolvedValue([
        { sourceRequirementId: 'req1', qtyOrdered: 15, qtyReceived: 15 },
      ]);
      prisma.tenant.stockReservation.findMany.mockResolvedValue([
        { productId: 'p1', customerOrderItemId: 'item1', source: 'STOCK', qty: 5, consumedQty: 0 },
        { productId: 'p1', customerOrderItemId: 'item1', source: 'PURCHASE', qty: 15, consumedQty: 0 },
      ]);

      const [line] = await service.getItemSummary(user, 'co1', 'item1');
      expect(line.coveredQty).toBe(20);
      expect(line.uncoveredQty).toBe(0);
      expect(line.status).toBe('FULLY_COVERED');
    });

    it('ISSUED_TO_PRODUCTION: fully consumed', async () => {
      prisma.tenant.orderMaterialRequirement.findMany.mockResolvedValue([
        { id: 'req1', productId: 'p1', qtyFromStock: 20, qtyToPurchase: 0 },
      ]);
      prisma.tenant.stockReservation.findMany.mockResolvedValue([
        { productId: 'p1', customerOrderItemId: 'item1', source: 'STOCK', qty: 0, consumedQty: 20 },
      ]);

      const [line] = await service.getItemSummary(user, 'co1', 'item1');
      expect(line.consumedQty).toBe(20);
      expect(line.status).toBe('ISSUED_TO_PRODUCTION');
    });

    it('computes availableQty as physical minus what OTHER orders (not this line) have reserved', async () => {
      prisma.tenant.warehouseStock.findMany.mockResolvedValue([{ productId: 'p1', qty: 100, reservedQty: 65 }]);
      prisma.tenant.stockReservation.findMany.mockResolvedValue([
        { productId: 'p1', customerOrderItemId: 'item1', source: 'STOCK', qty: 20, consumedQty: 0 }, // this line's own
        { productId: 'p1', customerOrderItemId: 'item-other', source: 'STOCK', qty: 45, consumedQty: 0 }, // someone else's
      ]);

      const [line] = await service.getItemSummary(user, 'co1', 'item1');
      expect(line.physicalQty).toBe(100);
      expect(line.reservedForThisOrderQty).toBe(20);
      expect(line.reservedByOthersQty).toBe(45);
      expect(line.availableQty).toBe(55); // 100 - 45
    });
  });

  describe('saveDecision — §2/§3', () => {
    it('reserves the full qtyFromStock on first save (delta = qtyFromStock - 0)', async () => {
      prisma.tenant.orderMaterialRequirement.findUnique.mockResolvedValue(null);
      prisma.tenant.orderMaterialRequirement.upsert.mockResolvedValue({ id: 'req1' });
      stockReservationService.reserveFromStock.mockResolvedValue({ grantedQty: 10, shortfallQty: 0 });

      await service.saveDecision(user, 'co1', 'item1', 'p1', { qtyFromStock: 10, qtyToPurchase: 10 });

      expect(stockReservationService.reserveFromStock).toHaveBeenCalledWith(
        user,
        { productId: 'p1', warehouseId: 'wDefault', customerOrderId: 'co1', customerOrderItemId: 'item1' },
        10,
      );
      expect(stockReservationService.release).not.toHaveBeenCalled();
    });

    it('reserves only the DELTA when increasing an existing decision', async () => {
      prisma.tenant.orderMaterialRequirement.findUnique.mockResolvedValue({ qtyFromStock: 5, qtyToPurchase: 15 });
      prisma.tenant.orderMaterialRequirement.upsert.mockResolvedValue({ id: 'req1' });
      stockReservationService.reserveFromStock.mockResolvedValue({ grantedQty: 5, shortfallQty: 0 });

      await service.saveDecision(user, 'co1', 'item1', 'p1', { qtyFromStock: 10, qtyToPurchase: 10 });

      expect(stockReservationService.reserveFromStock).toHaveBeenCalledWith(expect.anything(), expect.anything(), 5); // 10 - 5
    });

    it('releases the DELTA when decreasing an existing decision, after the requirement row is updated', async () => {
      prisma.tenant.orderMaterialRequirement.findUnique.mockResolvedValue({ qtyFromStock: 10, qtyToPurchase: 10 });
      prisma.tenant.orderMaterialRequirement.upsert.mockResolvedValue({ id: 'req1' });

      await service.saveDecision(user, 'co1', 'item1', 'p1', { qtyFromStock: 4, qtyToPurchase: 16 });

      expect(stockReservationService.reserveFromStock).not.toHaveBeenCalled();
      expect(stockReservationService.release).toHaveBeenCalledWith(
        user,
        { productId: 'p1', warehouseId: 'wDefault', customerOrderId: 'co1', customerOrderItemId: 'item1', source: 'STOCK' },
        6, // 10 - 4
      );
    });

    it('rejects a productId that is not actually a component of this line\'s assembly tree', async () => {
      await expect(
        service.saveDecision(user, 'co1', 'item1', 'not-a-component', { qtyFromStock: 1, qtyToPurchase: 0 }),
      ).rejects.toThrow();
      expect(prisma.tenant.orderMaterialRequirement.upsert).not.toHaveBeenCalled();
    });
  });
});
