import { ConflictException, NotFoundException } from '@nestjs/common';
import { CustomerOrderShortageService } from './customer-order-shortage.service';

describe('CustomerOrderShortageService', () => {
  let service: CustomerOrderShortageService;
  let prisma: any;
  let purchaseOrdersService: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  beforeEach(() => {
    prisma = {
      tenant: {
        customerOrder: { findUnique: jest.fn() },
        assemblyComponent: { findMany: jest.fn() },
        assembly: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
        product: { findMany: jest.fn().mockResolvedValue([]) },
        supplier: { findMany: jest.fn().mockResolvedValue([]) },
        finishedGood: { count: jest.fn().mockResolvedValue(0) },
      },
    };
    purchaseOrdersService = { create: jest.fn() };
    service = new CustomerOrderShortageService(prisma, purchaseOrdersService);
  });

  describe('previewShortage', () => {
    it('throws NotFoundException for an unknown order', async () => {
      prisma.tenant.customerOrder.findUnique.mockResolvedValue(null);
      await expect(service.previewShortage(user, 'co1')).rejects.toThrow(NotFoundException);
    });

    it('accumulates PRODUCT needs across two order lines that share a component (shared-pool fix, Phase 1 §6.3)', async () => {
      prisma.tenant.customerOrder.findUnique.mockResolvedValue({
        id: 'co1',
        items: [
          { assemblyId: 'a1', qty: 2 },
          { assemblyId: 'a2', qty: 3 },
        ],
      });
      // both assemblies need the same raw product p1
      prisma.tenant.assemblyComponent.findMany.mockImplementation(({ where }: any) => {
        if (where.assemblyId === 'a1') return Promise.resolve([{ componentType: 'PRODUCT', productId: 'p1', qtyPerUnit: 1 }]);
        if (where.assemblyId === 'a2') return Promise.resolve([{ componentType: 'PRODUCT', productId: 'p1', qtyPerUnit: 2 }]);
        return Promise.resolve([]);
      });
      prisma.tenant.product.findMany.mockResolvedValue([{ id: 'p1', article: 'P1', name: 'Part', defaultSupplierId: null, qty: 4 }]);

      const result = await service.previewShortage(user, 'co1');

      // a1: 2*1=2, a2: 3*2=6 -> shared pool total 8
      const bucket = result.groups.find((g) => g.supplierId === null)!;
      const line = bucket.lines.find((l) => l.productId === 'p1')!;
      expect(line.neededQty).toBe(8);
      expect(line.currentStock).toBe(4); // shown separately, never subtracted
    });

    it('stops recursion at a sub-assembly with a defaultSupplierId and adds it as its own buy-line', async () => {
      prisma.tenant.customerOrder.findUnique.mockResolvedValue({ id: 'co1', items: [{ assemblyId: 'parent', qty: 2 }] });
      prisma.tenant.assemblyComponent.findMany.mockImplementation(({ where }: any) => {
        if (where.assemblyId === 'parent') {
          return Promise.resolve([{ componentType: 'ASSEMBLY', subAssemblyId: 'purchasedSub', qtyPerUnit: 3 }]);
        }
        // if this were called for purchasedSub's own components, the "stop recursion" behavior is broken
        return Promise.resolve([{ componentType: 'PRODUCT', productId: 'shouldNotAppear', qtyPerUnit: 1 }]);
      });
      prisma.tenant.assembly.findUnique.mockResolvedValue({ id: 'purchasedSub', name: 'Bought Sub', defaultSupplierId: 'sup1' });
      prisma.tenant.assembly.findMany.mockResolvedValue([{ id: 'purchasedSub', name: 'Bought Sub', defaultSupplierId: 'sup1' }]);
      prisma.tenant.supplier.findMany.mockResolvedValue([{ id: 'sup1', name: 'Acme Supplier' }]);
      prisma.tenant.finishedGood.count.mockResolvedValue(1);

      const result = await service.previewShortage(user, 'co1');

      const group = result.groups.find((g) => g.supplierId === 'sup1')!;
      expect(group.supplierName).toBe('Acme Supplier');
      expect(group.lines).toEqual([
        { kind: 'ASSEMBLY', subAssemblyId: 'purchasedSub', description: 'Bought Sub', neededQty: 6, currentStock: 1 },
      ]);
      // 'shouldNotAppear' must never have been reached
      expect(result.groups.some((g) => g.lines.some((l: any) => l.productId === 'shouldNotAppear'))).toBe(false);
    });

    it('recurses into a sub-assembly with no defaultSupplierId ("we make it ourselves")', async () => {
      prisma.tenant.customerOrder.findUnique.mockResolvedValue({ id: 'co1', items: [{ assemblyId: 'parent', qty: 2 }] });
      prisma.tenant.assemblyComponent.findMany.mockImplementation(({ where }: any) => {
        if (where.assemblyId === 'parent') {
          return Promise.resolve([{ componentType: 'ASSEMBLY', subAssemblyId: 'madeInHouse', qtyPerUnit: 2 }]);
        }
        if (where.assemblyId === 'madeInHouse') {
          return Promise.resolve([{ componentType: 'PRODUCT', productId: 'p1', qtyPerUnit: 5 }]);
        }
        return Promise.resolve([]);
      });
      prisma.tenant.assembly.findUnique.mockResolvedValue({ id: 'madeInHouse', name: 'Made In House', defaultSupplierId: null });
      prisma.tenant.product.findMany.mockResolvedValue([{ id: 'p1', article: 'P1', name: 'Part', defaultSupplierId: null, qty: 0 }]);

      const result = await service.previewShortage(user, 'co1');

      // 2 (order qty) * 2 (qtyPerUnit of sub) * 5 (qtyPerUnit of product inside sub) = 20
      const bucket = result.groups.find((g) => g.supplierId === null)!;
      const line = bucket.lines.find((l) => l.productId === 'p1')!;
      expect(line.neededQty).toBe(20);
    });

    it('throws ConflictException on a circular BOM instead of recursing forever', async () => {
      prisma.tenant.customerOrder.findUnique.mockResolvedValue({ id: 'co1', items: [{ assemblyId: 'a1', qty: 1 }] });
      prisma.tenant.assemblyComponent.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve([{ componentType: 'ASSEMBLY', subAssemblyId: where.assemblyId === 'a1' ? 'a2' : 'a1', qtyPerUnit: 1 }]),
      );
      prisma.tenant.assembly.findUnique.mockImplementation(({ where }: any) =>
        Promise.resolve({ id: where.id, name: where.id, defaultSupplierId: null }),
      );

      await expect(service.previewShortage(user, 'co1')).rejects.toThrow(ConflictException);
    });
  });

  describe('createPurchaseOrdersFromGroups', () => {
    it('creates one PurchaseOrder per group with sourceCustomerOrderId set', async () => {
      prisma.tenant.customerOrder.findUnique.mockResolvedValue({ id: 'co1' });
      purchaseOrdersService.create.mockResolvedValue({ id: 'po1' });

      await service.createPurchaseOrdersFromGroups(user, 'co1', {
        groups: [
          {
            supplierId: 'sup1',
            supplierName: 'Acme',
            items: [{ kind: 'PRODUCT', productId: 'p1', description: 'P1', qty: 8 }],
          },
        ],
      } as any);

      expect(purchaseOrdersService.create).toHaveBeenCalledWith(
        user,
        expect.objectContaining({
          supplierId: 'sup1',
          supplierNameSnapshot: 'Acme',
          sourceCustomerOrderId: 'co1',
          items: [expect.objectContaining({ productId: 'p1', qtyOrdered: 8 })],
        }),
      );
    });
  });
});
