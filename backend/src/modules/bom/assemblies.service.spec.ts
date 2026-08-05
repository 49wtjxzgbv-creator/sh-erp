import { BadRequestException, ConflictException } from '@nestjs/common';
import { AssembliesService } from './assemblies.service';
import { ComponentTypeDto } from './dto/assembly-component.dto';

describe('AssembliesService', () => {
  let service: AssembliesService;
  let prisma: any;
  let audit: any;
  let stock: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  beforeEach(() => {
    prisma = {
      tenant: {
        assembly: {
          create: jest.fn(),
          findUnique: jest.fn(),
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
          update: jest.fn(),
        },
        assemblyComponent: {
          deleteMany: jest.fn(),
          createMany: jest.fn(),
          findMany: jest.fn().mockResolvedValue([]),
        },
        assemblyVersion: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
          findMany: jest.fn(),
        },
        assemblyVersionComponent: { createMany: jest.fn() },
        product: { findUnique: jest.fn() },
        warehouse: { findFirst: jest.fn() },
      },
    };
    audit = { record: jest.fn() };
    stock = { applyMovement: jest.fn() };
    service = new AssembliesService(prisma, audit, stock);
  });

  describe('setComponents — validation, versioning, cycle detection', () => {
    beforeEach(() => {
      prisma.tenant.assembly.findUnique.mockResolvedValue({ id: 'a1', components: [] });
    });

    it('rejects a PRODUCT line missing productId', async () => {
      await expect(
        service.setComponents(user, 'a1', {
          components: [{ componentType: ComponentTypeDto.PRODUCT, qtyPerUnit: 1 } as any],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an ASSEMBLY line missing subAssemblyId', async () => {
      await expect(
        service.setComponents(user, 'a1', {
          components: [{ componentType: ComponentTypeDto.ASSEMBLY, qtyPerUnit: 1 } as any],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an assembly containing itself as a component', async () => {
      await expect(
        service.setComponents(user, 'a1', {
          components: [{ componentType: ComponentTypeDto.ASSEMBLY, subAssemblyId: 'a1', qtyPerUnit: 1 }],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a transitive cycle (a1 -> a2, and a2 already contains a1)', async () => {
      // a2's existing (already-saved) components already point back to a1
      prisma.tenant.assemblyComponent.findMany.mockResolvedValue([
        { componentType: 'ASSEMBLY', subAssemblyId: 'a1' },
      ]);

      await expect(
        service.setComponents(user, 'a1', {
          components: [{ componentType: ComponentTypeDto.ASSEMBLY, subAssemblyId: 'a2', qtyPerUnit: 1 }],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('replaces all existing lines, creates version 1 for a fresh assembly', async () => {
      prisma.tenant.assemblyComponent.findMany.mockResolvedValueOnce([]); // no existing lines on a2 to check for cycles
      prisma.tenant.assemblyVersion.create.mockResolvedValue({ id: 'v1', versionNumber: 1 });
      prisma.tenant.assemblyComponent.findMany.mockResolvedValueOnce([{ id: 'line1' }]); // getComponents() call at the end

      const result = await service.setComponents(user, 'a1', {
        components: [{ componentType: ComponentTypeDto.PRODUCT, productId: 'p1', qtyPerUnit: 2 }],
      });

      expect(prisma.tenant.assemblyComponent.deleteMany).toHaveBeenCalledWith({ where: { assemblyId: 'a1' } });
      expect(prisma.tenant.assemblyComponent.createMany).toHaveBeenCalledWith({
        data: [{ assemblyId: 'a1', componentType: 'PRODUCT', productId: 'p1', subAssemblyId: null, warehouseId: null, qtyPerUnit: 2 }],
      });
      expect(prisma.tenant.assemblyVersion.create).toHaveBeenCalledWith({
        data: { assemblyId: 'a1', versionNumber: 1, createdById: 'u1' },
      });
      expect(result.version.versionNumber).toBe(1);
    });

    it('increments versionNumber on subsequent saves', async () => {
      prisma.tenant.assemblyVersion.findFirst.mockResolvedValue({ versionNumber: 4 });
      prisma.tenant.assemblyVersion.create.mockResolvedValue({ id: 'v5', versionNumber: 5 });

      await service.setComponents(user, 'a1', { components: [] });

      expect(prisma.tenant.assemblyVersion.create).toHaveBeenCalledWith({
        data: { assemblyId: 'a1', versionNumber: 5, createdById: 'u1' },
      });
    });
  });

  describe('calculateCost — recursive calcAssemblyCost_ port', () => {
    it('sums own per-unit costs + PRODUCT component costs (local vs German)', async () => {
      prisma.tenant.assembly.findUnique.mockResolvedValue({
        id: 'a1',
        laborCostPerUnit: 10,
        packagingCostPerUnit: 2,
        deliveryCostPerUnit: 1,
        otherCostPerUnit: 0,
        components: [{ componentType: 'PRODUCT', productId: 'p1', qtyPerUnit: 3 }],
      });
      prisma.tenant.product.findUnique.mockResolvedValue({ localPriceExclVat: 5, germanPriceExclVat: 8 });

      const result = await service.calculateCost(user, 'a1');

      // own = 13, plus 3 * 5 = 15 local -> 28; 3 * 8 = 24 german -> 37
      expect(result.localCostPerUnit).toBe(28);
      expect(result.germanCostPerUnit).toBe(37);
    });

    it('recurses into ASSEMBLY components and multiplies by qtyPerUnit', async () => {
      prisma.tenant.assembly.findUnique
        .mockResolvedValueOnce({
          id: 'parent',
          laborCostPerUnit: 0,
          packagingCostPerUnit: 0,
          deliveryCostPerUnit: 0,
          otherCostPerUnit: 0,
          components: [{ componentType: 'ASSEMBLY', subAssemblyId: 'child', qtyPerUnit: 2 }],
        })
        .mockResolvedValueOnce({
          id: 'child',
          laborCostPerUnit: 5,
          packagingCostPerUnit: 0,
          deliveryCostPerUnit: 0,
          otherCostPerUnit: 0,
          components: [],
        });

      const result = await service.calculateCost(user, 'parent');

      expect(result.localCostPerUnit).toBe(10); // child costs 5/unit, parent needs 2
      expect(result.germanCostPerUnit).toBe(10);
    });

    it('throws ConflictException on a circular BOM rather than looping forever', async () => {
      prisma.tenant.assembly.findUnique.mockImplementation(({ where }: any) =>
        Promise.resolve({
          id: where.id,
          laborCostPerUnit: 0,
          packagingCostPerUnit: 0,
          deliveryCostPerUnit: 0,
          otherCostPerUnit: 0,
          components: [{ componentType: 'ASSEMBLY', subAssemblyId: where.id === 'a1' ? 'a2' : 'a1', qtyPerUnit: 1 }],
        }),
      );

      await expect(service.calculateCost(user, 'a1')).rejects.toThrow(ConflictException);
    });
  });

  describe('checkAvailability / produce', () => {
    beforeEach(() => {
      prisma.tenant.assembly.findUnique.mockResolvedValue({ id: 'a1', components: [] });
    });

    it('flattens PRODUCT and nested ASSEMBLY components into a single per-product requirement map', async () => {
      prisma.tenant.assemblyComponent.findMany
        .mockResolvedValueOnce([
          { componentType: 'PRODUCT', productId: 'p1', qtyPerUnit: 2 },
          { componentType: 'ASSEMBLY', subAssemblyId: 'sub1', qtyPerUnit: 3 },
        ])
        .mockResolvedValueOnce([{ componentType: 'PRODUCT', productId: 'p1', qtyPerUnit: 1 }]); // sub1's own components also need p1

      prisma.tenant.product.findUnique.mockResolvedValue({ qty: 100 });

      const result = await service.checkAvailability(user, 'a1', 5);

      // top-level: 5 * 2 = 10 of p1 directly, plus 5*3=15 units of sub1, each needing 1 of p1 => +15 => 25 total
      expect(result.requirements).toEqual([{ productId: 'p1', needed: 25 }]);
      expect(result.sufficient).toBe(true);
    });

    it('reports a shortage when available stock is less than needed', async () => {
      prisma.tenant.assemblyComponent.findMany.mockResolvedValueOnce([
        { componentType: 'PRODUCT', productId: 'p1', qtyPerUnit: 10 },
      ]);
      prisma.tenant.product.findUnique.mockResolvedValue({ qty: 5 });

      const result = await service.checkAvailability(user, 'a1', 1);

      expect(result.sufficient).toBe(false);
      expect(result.shortages).toEqual([{ productId: 'p1', needed: 10, available: 5, shortage: 5 }]);
    });

    it('produce() rejects when stock is insufficient, without consuming anything', async () => {
      prisma.tenant.assemblyComponent.findMany.mockResolvedValueOnce([
        { componentType: 'PRODUCT', productId: 'p1', qtyPerUnit: 10 },
      ]);
      prisma.tenant.product.findUnique.mockResolvedValue({ qty: 1 });

      await expect(service.produce(user, 'a1', { qty: 1 } as any)).rejects.toThrow(BadRequestException);
      expect(stock.applyMovement).not.toHaveBeenCalled();
    });

    it('produce() consumes each flattened requirement via StockService.applyMovement with ASSEMBLY_CONSUMPTION, defaulting to the default warehouse', async () => {
      prisma.tenant.assembly.findUnique.mockResolvedValue({
        id: 'a1',
        name: 'Widget',
        laborCostPerUnit: 0,
        packagingCostPerUnit: 0,
        deliveryCostPerUnit: 0,
        otherCostPerUnit: 0,
        components: [],
      });
      prisma.tenant.assemblyComponent.findMany
        .mockResolvedValueOnce([{ componentType: 'PRODUCT', productId: 'p1', qtyPerUnit: 4 }]) // checkAvailability's flatten
        ;
      prisma.tenant.product.findUnique.mockResolvedValue({ qty: 100 });
      prisma.tenant.warehouse.findFirst.mockResolvedValue({ id: 'wDefault', isDefault: true });
      stock.applyMovement.mockResolvedValue({ id: 'm1' });

      const result = await service.produce(user, 'a1', { qty: 2 } as any);

      expect(stock.applyMovement).toHaveBeenCalledWith(
        user,
        expect.objectContaining({
          productId: 'p1',
          warehouseId: 'wDefault',
          type: 'ASSEMBLY_CONSUMPTION',
          qtyDelta: -8,
          sourceType: 'Assembly',
          sourceId: 'a1',
        }),
      );
      expect(result.qtyProduced).toBe(2);
      expect(result.warehouseId).toBe('wDefault');
    });

    it('produce() throws if no warehouse is given and none is configured as default', async () => {
      prisma.tenant.assembly.findUnique.mockResolvedValue({ id: 'a1', name: 'Widget', components: [] });
      prisma.tenant.assemblyComponent.findMany.mockResolvedValueOnce([]);
      prisma.tenant.warehouse.findFirst.mockResolvedValue(null);

      await expect(service.produce(user, 'a1', { qty: 1 } as any)).rejects.toThrow(BadRequestException);
    });
  });
});
