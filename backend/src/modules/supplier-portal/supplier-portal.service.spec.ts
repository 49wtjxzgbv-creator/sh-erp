import { SupplierPortalService } from './supplier-portal.service';

describe('SupplierPortalService', () => {
  let service: SupplierPortalService;
  let prisma: any;
  let auditService: any;
  let emailService: any;
  let filesService: any;
  const actor = { supplierPortalUserId: 'spu1', supplierOrganizationId: 'org1', activeConnectionId: 'conn1', companyId: 'c1', supplierId: 's1' } as any;

  beforeEach(() => {
    prisma = {
      tenant: {
        purchaseOrder: { findFirst: jest.fn() },
        purchaseRequest: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
        purchaseRequestItem: { update: jest.fn() },
        productSupplier: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
        user: { findUnique: jest.fn().mockResolvedValue({ id: 'staff1', email: 'staff@example.com' }) },
      },
    };
    auditService = { record: jest.fn() };
    emailService = { send: jest.fn().mockResolvedValue({ sent: true }) };
    filesService = { listForEntities: jest.fn().mockResolvedValue({}), listByIds: jest.fn().mockResolvedValue([]) };
    service = new SupplierPortalService(
      prisma,
      auditService,
      {} as any, // deliverySchedulesService — unused by these tests
      {} as any, // commentsService — unused by these tests
      filesService,
      emailService,
    );
  });

  describe('listPurchaseRequests', () => {
    it("scopes to the caller's own supplierId and excludes DRAFT", async () => {
      prisma.tenant.purchaseRequest.findMany.mockResolvedValue([{ id: 'pr1', status: 'SENT' }]);

      const result = await service.listPurchaseRequests(actor);

      expect(prisma.tenant.purchaseRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { supplierId: 's1', status: { not: 'DRAFT' } } }),
      );
      expect(result).toEqual({ items: [{ id: 'pr1', status: 'SENT' }] });
    });
  });

  describe('getPurchaseRequest', () => {
    it('404s for a request belonging to a different supplier (never distinguished from not-found)', async () => {
      prisma.tenant.purchaseRequest.findFirst.mockResolvedValue(null);
      await expect(service.getPurchaseRequest(actor, 'pr1')).rejects.toThrow();
    });

    it('404s for a DRAFT request — not visible even if it happens to be this supplier\'s own', async () => {
      prisma.tenant.purchaseRequest.findFirst.mockResolvedValue(null); // the where-clause itself excludes DRAFT
      await expect(service.getPurchaseRequest(actor, 'pr1')).rejects.toThrow();
      expect(prisma.tenant.purchaseRequest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'pr1', supplierId: 's1', status: { not: 'DRAFT' } } }),
      );
    });

    it('returns the request when it belongs to this supplier and is not DRAFT', async () => {
      prisma.tenant.purchaseRequest.findFirst.mockResolvedValue({ id: 'pr1', status: 'SENT', items: [] });
      const result = await service.getPurchaseRequest(actor, 'pr1');
      expect(result).toEqual({ id: 'pr1', status: 'SENT', items: [] });
    });

    it("attaches each line's product photo URL ahead of the article (2026-11-02)", async () => {
      prisma.tenant.purchaseRequest.findFirst.mockResolvedValue({
        id: 'pr1',
        status: 'SENT',
        items: [
          { id: 'item1', productId: 'p1', articleSnapshot: 'ABC', attachedFileIds: [] },
          { id: 'item2', productId: null, articleSnapshot: 'XYZ', attachedFileIds: [] },
        ],
      });
      filesService.listForEntities.mockResolvedValue({ p1: [{ downloadUrl: 'https://example.com/p1.jpg' }] });

      const result = await service.getPurchaseRequest(actor, 'pr1');

      expect(filesService.listForEntities).toHaveBeenCalledWith(expect.anything(), 'Product', ['p1'], ['PRODUCT_PHOTO']);
      expect(result.items).toEqual([
        { id: 'item1', productId: 'p1', articleSnapshot: 'ABC', attachedFileIds: [], photoUrl: 'https://example.com/p1.jpg', attachedFiles: [] },
        { id: 'item2', productId: null, articleSnapshot: 'XYZ', attachedFileIds: [], photoUrl: null, attachedFiles: [] },
      ]);
    });

    it('skips the photo lookup entirely when no line has a productId', async () => {
      prisma.tenant.purchaseRequest.findFirst.mockResolvedValue({
        id: 'pr1',
        status: 'SENT',
        items: [{ id: 'item1', productId: null, attachedFileIds: [] }],
      });

      await service.getPurchaseRequest(actor, 'pr1');

      expect(filesService.listForEntities).not.toHaveBeenCalled();
    });

    it("resolves each line's attachedFileIds to downloadable files, dropping any id that no longer resolves (2026-11-02)", async () => {
      prisma.tenant.purchaseRequest.findFirst.mockResolvedValue({
        id: 'pr1',
        status: 'SENT',
        items: [{ id: 'item1', productId: null, attachedFileIds: ['f1', 'f-stale'] }],
      });
      filesService.listByIds.mockResolvedValue([{ id: 'f1', originalName: 'invoice.pdf', downloadUrl: 'https://example.com/f1.pdf' }]);

      const result = await service.getPurchaseRequest(actor, 'pr1');

      expect(filesService.listByIds).toHaveBeenCalledWith(expect.anything(), ['f1', 'f-stale']);
      expect(result.items[0].attachedFiles).toEqual([{ id: 'f1', originalName: 'invoice.pdf', downloadUrl: 'https://example.com/f1.pdf' }]);
    });

    it('skips the attached-files lookup entirely when no line has any attachedFileIds', async () => {
      prisma.tenant.purchaseRequest.findFirst.mockResolvedValue({
        id: 'pr1',
        status: 'SENT',
        items: [{ id: 'item1', productId: null, attachedFileIds: [] }],
      });

      await service.getPurchaseRequest(actor, 'pr1');

      expect(filesService.listByIds).not.toHaveBeenCalled();
    });
  });

  describe('getPurchaseOrder', () => {
    it('404s for an order belonging to a different supplier', async () => {
      prisma.tenant.purchaseOrder.findFirst.mockResolvedValue(null);
      await expect(service.getPurchaseOrder(actor, 'po1')).rejects.toThrow();
    });

    it("attaches each line's product photo URL", async () => {
      prisma.tenant.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po1',
        items: [{ id: 'item1', productId: 'p1', articleSnapshot: 'ABC' }],
      });
      filesService.listForEntities.mockResolvedValue({ p1: [{ downloadUrl: 'https://example.com/p1.jpg' }] });

      const result = await service.getPurchaseOrder(actor, 'po1');

      expect(result.items).toEqual([{ id: 'item1', productId: 'p1', articleSnapshot: 'ABC', photoUrl: 'https://example.com/p1.jpg' }]);
    });
  });

  describe('quotePurchaseRequest', () => {
    const sentRequest = {
      id: 'pr1',
      number: 'ЗП-2026-0001',
      status: 'SENT',
      createdById: 'staff1',
      items: [
        { id: 'item1', productId: null, attachedFileIds: [] },
        { id: 'item2', productId: null, attachedFileIds: [] },
      ],
    };

    it('rejects quoting a request that is not SENT', async () => {
      prisma.tenant.purchaseRequest.findFirst.mockResolvedValue({ ...sentRequest, status: 'CONVERTED' });
      await expect(service.quotePurchaseRequest(actor, 'pr1', { items: [{ id: 'item1', quotedPrice: 10 }] })).rejects.toThrow();
      expect(prisma.tenant.purchaseRequestItem.update).not.toHaveBeenCalled();
    });

    it('rejects a line id that does not belong to this request', async () => {
      prisma.tenant.purchaseRequest.findFirst.mockResolvedValue(sentRequest);
      await expect(
        service.quotePurchaseRequest(actor, 'pr1', { items: [{ id: 'not-a-real-line', quotedPrice: 10 }] }),
      ).rejects.toThrow();
      expect(prisma.tenant.purchaseRequestItem.update).not.toHaveBeenCalled();
    });

    it('updates supplierQuotedPrice per line, sets supplierRespondedAt, and best-effort-emails the creator', async () => {
      prisma.tenant.purchaseRequest.findFirst.mockResolvedValue(sentRequest);
      prisma.tenant.purchaseRequest.update.mockResolvedValue({ ...sentRequest, supplierRespondedAt: new Date() });

      await service.quotePurchaseRequest(actor, 'pr1', {
        items: [
          { id: 'item1', quotedPrice: 100 },
          { id: 'item2', quotedPrice: 200 },
        ],
      });

      expect(prisma.tenant.purchaseRequestItem.update).toHaveBeenCalledWith({ where: { id: 'item1' }, data: { supplierQuotedPrice: 100 } });
      expect(prisma.tenant.purchaseRequestItem.update).toHaveBeenCalledWith({ where: { id: 'item2' }, data: { supplierQuotedPrice: 200 } });
      expect(prisma.tenant.purchaseRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'pr1' }, data: { supplierRespondedAt: expect.any(Date) } }),
      );
      expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'purchase_request.supplier_quoted' }));
      expect(emailService.send).toHaveBeenCalledWith('staff@example.com', expect.any(String), expect.stringContaining('ЗП-2026-0001'));
    });

    it('does not fail the quote when the best-effort staff email throws', async () => {
      prisma.tenant.purchaseRequest.findFirst.mockResolvedValue(sentRequest);
      prisma.tenant.purchaseRequest.update.mockResolvedValue({ ...sentRequest, supplierRespondedAt: new Date() });
      emailService.send.mockRejectedValue(new Error('smtp down'));

      await expect(
        service.quotePurchaseRequest(actor, 'pr1', { items: [{ id: 'item1', quotedPrice: 100 }] }),
      ).resolves.toBeDefined();
    });
  });

  describe('listCatalog', () => {
    it("scopes to the caller's own supplierId and never exposes staff's price/isDefault", async () => {
      prisma.tenant.productSupplier.findMany.mockResolvedValue([
        {
          id: 'ps1',
          productId: 'p1',
          price: 999, // staff's own — must never appear in the response
          isDefault: true, // staff's own — must never appear in the response
          supplierCostPrice: null,
          supplierOfferedPrice: 50,
          createdAt: new Date('2026-11-01'),
          product: { article: 'ABC', name: 'Widget', weightPerUnitKg: '1.500', cuttingSpec: null },
        },
      ]);
      filesService.listForEntities.mockResolvedValue({ p1: [{ downloadUrl: 'https://example.com/p1.jpg' }] });

      const result = await service.listCatalog(actor);

      expect(prisma.tenant.productSupplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { supplierId: 's1' } }),
      );
      expect(result.items).toEqual([
        {
          id: 'ps1',
          productId: 'p1',
          article: 'ABC',
          name: 'Widget',
          weightPerUnitKg: '1.500',
          photoUrl: 'https://example.com/p1.jpg',
          files: [],
          cuttingSpec: null,
          supplierCostPrice: null,
          supplierOfferedPrice: 50,
          createdAt: new Date('2026-11-01'),
        },
      ]);
      expect(result.items[0]).not.toHaveProperty('price');
      expect(result.items[0]).not.toHaveProperty('isDefault');
    });
  });

  describe('getCatalogEntry', () => {
    const rawEntry = {
      id: 'ps1',
      productId: 'p1',
      price: 999,
      isDefault: true,
      supplierCostPrice: 10,
      supplierOfferedPrice: 50,
      createdAt: new Date('2026-11-01'),
      product: {
        article: 'ABC',
        name: 'Widget',
        weightPerUnitKg: '1.500',
        cuttingSpec: { kind: 'SHEET', stockLengthCm: 200, stockWidthCm: 100, defaultCutLengthCm: 50, defaultCutWidthCm: 40, defaultCutShapePolygon: { outerCm: [], holesCm: [] } },
      },
    };

    it('404s for an entry belonging to a different supplier (never distinguished from not-found)', async () => {
      prisma.tenant.productSupplier.findFirst.mockResolvedValue(null);
      await expect(service.getCatalogEntry(actor, 'ps1')).rejects.toThrow();
    });

    it('enriches with photo + product documents, includes the cutting spec, and strips price/isDefault', async () => {
      prisma.tenant.productSupplier.findFirst.mockResolvedValue(rawEntry);
      filesService.listForEntities.mockImplementation((_actor: any, _type: string, _ids: string[], domains: string[]) =>
        domains.includes('PRODUCT_PHOTO')
          ? Promise.resolve({ p1: [{ downloadUrl: 'https://example.com/p1.jpg' }] })
          : Promise.resolve({ p1: [{ id: 'f1', originalName: 'model.glb', downloadUrl: 'https://example.com/model.glb' }] }),
      );

      const result = await service.getCatalogEntry(actor, 'ps1');

      expect(result).toEqual({
        id: 'ps1',
        productId: 'p1',
        article: 'ABC',
        name: 'Widget',
        weightPerUnitKg: '1.500',
        photoUrl: 'https://example.com/p1.jpg',
        files: [{ id: 'f1', originalName: 'model.glb', downloadUrl: 'https://example.com/model.glb' }],
        cuttingSpec: { kind: 'SHEET', stockLengthCm: 200, stockWidthCm: 100, defaultCutLengthCm: 50, defaultCutWidthCm: 40, defaultCutShapePolygon: { outerCm: [], holesCm: [] } },
        supplierCostPrice: 10,
        supplierOfferedPrice: 50,
        createdAt: new Date('2026-11-01'),
      });
      expect(result).not.toHaveProperty('price');
      expect(result).not.toHaveProperty('isDefault');
    });
  });

  describe('updateCatalogEntry', () => {
    it('404s for an entry belonging to a different supplier', async () => {
      prisma.tenant.productSupplier.findFirst.mockResolvedValue(null);
      await expect(service.updateCatalogEntry(actor, 'ps1', { supplierOfferedPrice: 50 })).rejects.toThrow();
      expect(prisma.tenant.productSupplier.update).not.toHaveBeenCalled();
    });

    it("updates only the supplier's own two fields, audit-logs, and returns the re-fetched entry", async () => {
      prisma.tenant.productSupplier.findFirst.mockResolvedValue({ id: 'ps1', productId: 'p1' });
      prisma.tenant.productSupplier.update.mockResolvedValue({});
      // getCatalogEntry's own re-fetch after the update:
      prisma.tenant.productSupplier.findFirst.mockResolvedValueOnce({ id: 'ps1', productId: 'p1' }).mockResolvedValueOnce({
        id: 'ps1',
        productId: 'p1',
        price: 999,
        isDefault: false,
        supplierCostPrice: 10,
        supplierOfferedPrice: 50,
        createdAt: new Date('2026-11-01'),
        product: { article: 'ABC', name: 'Widget', weightPerUnitKg: null, cuttingSpec: null },
      });

      const result = await service.updateCatalogEntry(actor, 'ps1', { supplierCostPrice: 10, supplierOfferedPrice: 50 });

      expect(prisma.tenant.productSupplier.update).toHaveBeenCalledWith({
        where: { id: 'ps1' },
        data: { supplierCostPrice: 10, supplierOfferedPrice: 50 },
      });
      expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'product_supplier.catalog_updated' }));
      expect(result.supplierCostPrice).toBe(10);
      expect(result.supplierOfferedPrice).toBe(50);
    });
  });
});
