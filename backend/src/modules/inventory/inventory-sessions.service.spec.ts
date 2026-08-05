import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InventorySessionsService } from './inventory-sessions.service';

describe('InventorySessionsService', () => {
  let service: InventorySessionsService;
  let prisma: any;
  let audit: any;
  let stock: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  beforeEach(() => {
    prisma = {
      tenant: {
        product: { findMany: jest.fn().mockResolvedValue([]) },
        inventorySession: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
        inventoryItem: { createMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), findMany: jest.fn() },
        warehouse: { findFirst: jest.fn() },
      },
    };
    audit = { record: jest.fn() };
    stock = { applyMovement: jest.fn() };
    service = new InventorySessionsService(prisma, audit, stock);
  });

  it('start() snapshots every active product\'s current qty as expectedQty', async () => {
    prisma.tenant.product.findMany.mockResolvedValue([
      { id: 'p1', qty: 10 },
      { id: 'p2', qty: 0 },
    ]);
    prisma.tenant.inventorySession.create.mockResolvedValue({ id: 's1', name: 'Q3' });

    await service.start(user, { name: 'Q3' });

    expect(prisma.tenant.inventoryItem.createMany).toHaveBeenCalledWith({
      data: [
        { inventorySessionId: 's1', productId: 'p1', expectedQty: 10 },
        { inventorySessionId: 's1', productId: 'p2', expectedQty: 0 },
      ],
    });
  });

  it('start() with zero active products creates the session without calling createMany', async () => {
    prisma.tenant.product.findMany.mockResolvedValue([]);
    prisma.tenant.inventorySession.create.mockResolvedValue({ id: 's1' });
    await service.start(user, { name: 'Empty' });
    expect(prisma.tenant.inventoryItem.createMany).not.toHaveBeenCalled();
  });

  it('recordCount() rejects a product not part of the session', async () => {
    prisma.tenant.inventorySession.findUnique.mockResolvedValue({ id: 's1', status: 'IN_PROGRESS' });
    prisma.tenant.inventoryItem.findFirst.mockResolvedValue(null);
    await expect(service.recordCount(user, 's1', { productId: 'px', actualQty: 5 })).rejects.toThrow(NotFoundException);
  });

  it('recordCount() rejects on an already-completed session', async () => {
    prisma.tenant.inventorySession.findUnique.mockResolvedValue({ id: 's1', status: 'COMPLETED' });
    await expect(service.recordCount(user, 's1', { productId: 'p1', actualQty: 5 })).rejects.toThrow(BadRequestException);
  });

  describe('complete()', () => {
    it('posts one INVENTORY_RECONCILIATION movement per discrepancy, against the default warehouse', async () => {
      prisma.tenant.inventorySession.findUnique.mockResolvedValue({ id: 's1', status: 'IN_PROGRESS', name: 'Q3' });
      prisma.tenant.warehouse.findFirst.mockResolvedValue({ id: 'wDefault', isDefault: true });
      // mockImplementation (not a flat mockResolvedValue) so this actually
      // honors the `where: { counted: true }` filter complete() passes —
      // found and fixed: a flat mockResolvedValue here ignored that filter
      // entirely and fed the uncounted p3 row back in as if the DB's own
      // `counted: true` WHERE clause hadn't excluded it, producing a
      // spurious second reconciliation movement. The service code itself
      // was already correct against a real database; this was a test-mock
      // fidelity gap, only surfaced once tests could actually execute
      // (previously verification was type-check-only — see the backend
      // README's verification-methodology note).
      prisma.tenant.inventoryItem.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve(
          [
            { productId: 'p1', expectedQty: 10, actualQty: 8, counted: true }, // discrepancy: -2
            { productId: 'p2', expectedQty: 5, actualQty: 5, counted: true }, // no discrepancy
            { productId: 'p3', expectedQty: 3, actualQty: null, counted: false }, // not counted — excluded by the where clause
          ].filter((item) => where.counted === undefined || item.counted === where.counted),
        ),
      );
      prisma.tenant.inventorySession.update.mockResolvedValue({ id: 's1', status: 'COMPLETED' });

      const result = await service.complete(user, 's1');

      expect(stock.applyMovement).toHaveBeenCalledTimes(1);
      expect(stock.applyMovement).toHaveBeenCalledWith(
        user,
        expect.objectContaining({
          productId: 'p1',
          warehouseId: 'wDefault',
          type: 'INVENTORY_RECONCILIATION',
          qtyDelta: -2,
          sourceType: 'InventorySession',
          sourceId: 's1',
        }),
      );
      expect(result.discrepanciesReconciled).toBe(1);
      expect(prisma.tenant.inventorySession.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { status: 'COMPLETED', completedAt: expect.any(Date) },
      });
    });

    it('throws if there is no default warehouse configured', async () => {
      prisma.tenant.inventorySession.findUnique.mockResolvedValue({ id: 's1', status: 'IN_PROGRESS' });
      prisma.tenant.warehouse.findFirst.mockResolvedValue(null);
      await expect(service.complete(user, 's1')).rejects.toThrow(BadRequestException);
      expect(stock.applyMovement).not.toHaveBeenCalled();
    });

    it('rejects completing an already-completed session', async () => {
      prisma.tenant.inventorySession.findUnique.mockResolvedValue({ id: 's1', status: 'COMPLETED' });
      await expect(service.complete(user, 's1')).rejects.toThrow(BadRequestException);
    });
  });
});
