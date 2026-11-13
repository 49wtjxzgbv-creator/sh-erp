import { SupplierPortalService } from './supplier-portal.service';

describe('SupplierPortalService', () => {
  let service: SupplierPortalService;
  let prisma: any;
  let auditService: any;
  let emailService: any;
  let filesService: any;
  let financeService: any;
  let supplierCatalogService: any;
  const actor = { supplierPortalUserId: 'spu1', supplierOrganizationId: 'org1', activeConnectionId: 'conn1', companyId: 'c1', supplierId: 's1' } as any;

  beforeEach(() => {
    prisma = {
      tenant: {
        purchaseOrder: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
        purchaseOrderItem: { findFirst: jest.fn(), update: jest.fn() },
        purchaseRequest: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), count: jest.fn().mockResolvedValue(0) },
        purchaseRequestItem: { update: jest.fn() },
        productSupplier: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn(), update: jest.fn(), count: jest.fn().mockResolvedValue(0) },
        productCuttingSpec: { findMany: jest.fn().mockResolvedValue([]) },
        user: { findUnique: jest.fn().mockResolvedValue({ id: 'staff1', email: 'staff@example.com' }) },
        fileAsset: { findUnique: jest.fn() },
      },
    };
    auditService = { record: jest.fn() };
    emailService = { send: jest.fn().mockResolvedValue({ sent: true }) };
    filesService = {
      listForEntities: jest.fn().mockResolvedValue({}),
      listByIds: jest.fn().mockResolvedValue([]),
      listForEntity: jest.fn(),
      createPresignedUpload: jest.fn(),
      confirmUpload: jest.fn(),
      getDownloadUrl: jest.fn(),
    };
    financeService = {
      listDocumentsForSupplier: jest.fn(),
      getDocumentForSupplier: jest.fn(),
      createDocumentAsSupplier: jest.fn(),
      addPaymentAsSupplier: jest.fn(),
    };
    supplierCatalogService = { recordSupplierQuotedPrices: jest.fn().mockResolvedValue(undefined) };
    service = new SupplierPortalService(
      prisma,
      auditService,
      {} as any, // deliverySchedulesService — unused by these tests
      {} as any, // commentsService — unused by these tests
      filesService,
      emailService,
      financeService,
      supplierCatalogService,
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
        { id: 'item1', productId: 'p1', articleSnapshot: 'ABC', attachedFileIds: [], photoUrl: 'https://example.com/p1.jpg', attachedFiles: [], catalogPrice: null },
        { id: 'item2', productId: null, articleSnapshot: 'XYZ', attachedFileIds: [], photoUrl: null, attachedFiles: [], catalogPrice: null },
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

    it(
      "в наступних заявках автоматично підтягуватися — attaches this supplier's own existing catalog price " +
        '(ProductSupplier.supplierOfferedPrice) per line, so an unquoted line on a NEW заявка can pre-fill from it',
      async () => {
        prisma.tenant.purchaseRequest.findFirst.mockResolvedValue({
          id: 'pr2',
          status: 'SENT',
          items: [
            { id: 'item1', productId: 'p1', articleSnapshot: 'ABC', attachedFileIds: [] },
            { id: 'item2', productId: 'p2', articleSnapshot: 'DEF', attachedFileIds: [] }, // never quoted before — no catalog row yet
          ],
        });
        prisma.tenant.productSupplier.findMany.mockResolvedValue([{ productId: 'p1', supplierOfferedPrice: 123.45 }]);

        const result = await service.getPurchaseRequest(actor, 'pr2');

        expect(prisma.tenant.productSupplier.findMany).toHaveBeenCalledWith({
          where: { supplierId: 's1', productId: { in: ['p1', 'p2'] } },
          select: { productId: true, supplierOfferedPrice: true },
        });
        expect(result.items.find((i: any) => i.id === 'item1')!.catalogPrice).toBe(123.45);
        expect(result.items.find((i: any) => i.id === 'item2')!.catalogPrice).toBeNull();
      },
    );
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

      expect(result.items).toEqual([{ id: 'item1', productId: 'p1', articleSnapshot: 'ABC', photoUrl: 'https://example.com/p1.jpg', catalogPrice: null }]);
    });

    it(
      "в ваші замовлення на закупівлю в нього в колонці ваша ціна порожньо (2026-11-09) — attaches this supplier's " +
        "own catalog price per line, so a brand new order's \"Ваша ціна\" input can pre-fill from it",
      async () => {
        prisma.tenant.purchaseOrder.findFirst.mockResolvedValue({
          id: 'po1',
          items: [{ id: 'item1', productId: 'p1', articleSnapshot: 'ABC' }],
        });
        prisma.tenant.productSupplier.findMany.mockResolvedValue([{ productId: 'p1', supplierOfferedPrice: 5.4 }]);

        const result = await service.getPurchaseOrder(actor, 'po1');

        expect(prisma.tenant.productSupplier.findMany).toHaveBeenCalledWith({
          where: { supplierId: 's1', productId: { in: ['p1'] } },
          select: { productId: true, supplierOfferedPrice: true },
        });
        expect(result.items[0].catalogPrice).toBe(5.4);
      },
    );
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

    it(
      "ціни його мають підтягуватись в його ж каталог — syncs each quoted line's price into SupplierCatalogService, " +
        'keyed by the actor\'s own companyId/supplierId, skipping lines with no productId',
      async () => {
        const requestWithProducts = {
          ...sentRequest,
          items: [
            { id: 'item1', productId: 'p1', attachedFileIds: [] },
            { id: 'item2', productId: null, attachedFileIds: [] }, // article not yet in Products — no catalog entry possible
          ],
        };
        prisma.tenant.purchaseRequest.findFirst.mockResolvedValue(requestWithProducts);
        prisma.tenant.purchaseRequest.update.mockResolvedValue({ ...requestWithProducts, supplierRespondedAt: new Date() });

        await service.quotePurchaseRequest(actor, 'pr1', {
          items: [
            { id: 'item1', quotedPrice: 150 },
            { id: 'item2', quotedPrice: 50 },
          ],
        });

        expect(supplierCatalogService.recordSupplierQuotedPrices).toHaveBeenCalledWith('c1', 's1', [{ productId: 'p1', price: 150 }]);
      },
    );
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
      filesService.listForEntities.mockImplementation((_actor: any, _type: string, _ids: string[], domains: string[]) =>
        domains.includes('PRODUCT_PHOTO') ? Promise.resolve({ p1: [{ downloadUrl: 'https://example.com/p1.jpg' }] }) : Promise.resolve({}),
      );

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

    it("passes through the full file rows (not truncated) so View3DButton/ArViewButton have what they need (2026-11-02)", async () => {
      prisma.tenant.productSupplier.findMany.mockResolvedValue([
        {
          id: 'ps1',
          productId: 'p1',
          price: null,
          isDefault: false,
          supplierCostPrice: null,
          supplierOfferedPrice: null,
          createdAt: new Date('2026-11-01'),
          product: { article: 'ABC', name: 'Widget', weightPerUnitKg: null, cuttingSpec: null },
        },
      ]);
      const modelFile = { id: 'f1', originalName: 'model.glb', downloadUrl: 'https://example.com/f1.glb', mimeType: 'model/gltf-binary', arOptimizedDownloadUrl: 'https://example.com/f1-ar.glb' };
      filesService.listForEntities.mockImplementation((_actor: any, _type: string, _ids: string[], domains: string[]) =>
        domains.includes('PRODUCT_DOCUMENT') ? Promise.resolve({ p1: [modelFile] }) : Promise.resolve({}),
      );

      const result = await service.listCatalog(actor);

      expect(result.items[0].files).toEqual([modelFile]);
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

  describe('listUpcomingDeliveries', () => {
    it("scopes to the caller's own supplierId and excludes DELIVERED orders", async () => {
      await service.listUpcomingDeliveries(actor);
      expect(prisma.tenant.purchaseOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { supplierId: 's1', status: { not: 'DELIVERED' } } }),
      );
    });

    it('flattens one row per delivery-schedule line, sorted soonest-first', async () => {
      prisma.tenant.purchaseOrder.findMany.mockResolvedValue([
        {
          id: 'po1',
          expectedDeliveryDate: null,
          items: [
            {
              productId: 'p1',
              articleSnapshot: 'ABC',
              productNameSnapshot: 'Widget',
              qtyOrdered: 100,
              qtyReceived: 20,
              currentDeliverySchedule: {
                status: 'PENDING',
                lines: [
                  { date: new Date('2026-12-01'), qty: 40 },
                  { date: new Date('2026-11-10'), qty: 20 },
                  { date: new Date('2026-11-20'), qty: 40 },
                ],
              },
            },
          ],
        },
      ]);

      const result = await service.listUpcomingDeliveries(actor);

      expect(result.items.map((i: any) => i.date.toISOString())).toEqual([
        new Date('2026-11-10').toISOString(),
        new Date('2026-11-20').toISOString(),
        new Date('2026-12-01').toISOString(),
      ]);
      expect(result.items[0]).toMatchObject({ orderId: 'po1', article: 'ABC', qty: 20, scheduleStatus: 'PENDING' });
    });

    it("synthesizes one row from the order's own expectedDeliveryDate when an item has no schedule at all", async () => {
      prisma.tenant.purchaseOrder.findMany.mockResolvedValue([
        {
          id: 'po2',
          expectedDeliveryDate: new Date('2026-11-15'),
          items: [
            {
              productId: 'p2',
              articleSnapshot: 'XYZ',
              productNameSnapshot: 'Gadget',
              qtyOrdered: 50,
              qtyReceived: 10,
              currentDeliverySchedule: null,
            },
          ],
        },
      ]);

      const result = await service.listUpcomingDeliveries(actor);

      expect(result.items).toEqual([
        expect.objectContaining({ orderId: 'po2', article: 'XYZ', qty: 40, scheduleStatus: null }),
      ]);
    });

    it('skips an unscheduled item with no expectedDeliveryDate, and one with nothing actually outstanding', async () => {
      prisma.tenant.purchaseOrder.findMany.mockResolvedValue([
        {
          id: 'po3',
          expectedDeliveryDate: null,
          items: [{ productId: 'p3', articleSnapshot: 'NODATE', productNameSnapshot: '-', qtyOrdered: 10, qtyReceived: 0, currentDeliverySchedule: null }],
        },
        {
          id: 'po4',
          expectedDeliveryDate: new Date('2026-11-15'),
          items: [{ productId: 'p4', articleSnapshot: 'DONE', productNameSnapshot: '-', qtyOrdered: 10, qtyReceived: 10, currentDeliverySchedule: null }],
        },
      ]);

      const result = await service.listUpcomingDeliveries(actor);

      expect(result.items).toEqual([]);
    });

    // "коли натискаєш на деталь чи виріб у списку то потрібно щоб
    // відкривалась інформація про деталь в каталозі" (2026-11-13)
    it("resolves each row's own ProductSupplier catalog-entry id (null for a line with no productId, or no entry yet)", async () => {
      prisma.tenant.purchaseOrder.findMany.mockResolvedValue([
        {
          id: 'po5',
          expectedDeliveryDate: new Date('2026-11-15'),
          items: [
            { productId: 'p1', articleSnapshot: 'ABC', productNameSnapshot: 'Widget', qtyOrdered: 10, qtyReceived: 0, currentDeliverySchedule: null },
            { productId: 'p2', articleSnapshot: 'NOENTRY', productNameSnapshot: 'No catalog entry', qtyOrdered: 10, qtyReceived: 0, currentDeliverySchedule: null },
            { productId: null, articleSnapshot: 'ASM', productNameSnapshot: 'виріб line', qtyOrdered: 2, qtyReceived: 0, currentDeliverySchedule: null },
          ],
        },
      ]);
      prisma.tenant.productSupplier.findMany.mockResolvedValue([{ id: 'ps1', productId: 'p1' }]);

      const result = await service.listUpcomingDeliveries(actor);

      expect(result.items).toEqual([
        expect.objectContaining({ article: 'ABC', catalogEntryId: 'ps1' }),
        expect.objectContaining({ article: 'NOENTRY', catalogEntryId: null }),
        expect.objectContaining({ article: 'ASM', catalogEntryId: null }),
      ]);
    });
  });

  describe('getDashboardSummary', () => {
    it('returns the four plain counts plus overdue/upcoming delivery buckets', async () => {
      prisma.tenant.purchaseOrder.count.mockResolvedValue(3);
      prisma.tenant.purchaseRequest.count.mockResolvedValue(2);
      prisma.tenant.productSupplier.count.mockResolvedValue(7);

      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const inTwoDays = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
      const inThirtyDays = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      prisma.tenant.purchaseOrder.findMany.mockResolvedValue([
        {
          id: 'po1',
          expectedDeliveryDate: null,
          items: [
            {
              productId: 'p1',
              articleSnapshot: 'A',
              productNameSnapshot: '-',
              qtyOrdered: 10,
              qtyReceived: 0,
              currentDeliverySchedule: { status: 'PENDING', lines: [{ date: yesterday, qty: 5 }, { date: inTwoDays, qty: 3 }, { date: inThirtyDays, qty: 2 }] },
            },
          ],
        },
      ]);

      const result = await service.getDashboardSummary(actor);

      expect(result).toEqual({
        activeOrdersCount: 3,
        pendingQuotesCount: 2,
        catalogCount: 7,
        overdueDeliveriesCount: 1,
        upcomingDeliveriesCount: 1,
      });
      expect(prisma.tenant.purchaseOrder.count).toHaveBeenCalledWith({ where: { supplierId: 's1', status: { not: 'DELIVERED' } } });
      expect(prisma.tenant.purchaseRequest.count).toHaveBeenCalledWith({ where: { supplierId: 's1', status: 'SENT', supplierRespondedAt: null } });
      expect(prisma.tenant.productSupplier.count).toHaveBeenCalledWith({ where: { supplierId: 's1' } });
    });
  });

  describe('listStock', () => {
    it('includes only items with something still outstanding, carrying supplierReadyQty', async () => {
      prisma.tenant.purchaseOrder.findMany.mockResolvedValue([
        {
          id: 'po1',
          orderDate: new Date('2026-10-01'),
          items: [
            { id: 'item1', productId: 'p1', articleSnapshot: 'A', productNameSnapshot: '-', qtyOrdered: 100, qtyReceived: 20, supplierReadyQty: 30 },
            { id: 'item2', productId: 'p2', articleSnapshot: 'B', productNameSnapshot: '-', qtyOrdered: 10, qtyReceived: 10, supplierReadyQty: 0 },
          ],
        },
      ]);

      const result = await service.listStock(actor);

      expect(result.items).toEqual([
        expect.objectContaining({ itemId: 'item1', qtyRemaining: 80, supplierReadyQty: 30, cuttingSpec: null }),
      ]);
    });

    it("carries the picked item's own cutting spec, for the cutting-tool line picker to pre-fill from", async () => {
      prisma.tenant.purchaseOrder.findMany.mockResolvedValue([
        {
          id: 'po1',
          orderDate: new Date('2026-10-01'),
          items: [
            { id: 'item1', productId: 'p1', articleSnapshot: 'A', productNameSnapshot: '-', qtyOrdered: 100, qtyReceived: 20, supplierReadyQty: 0 },
          ],
        },
      ]);
      prisma.tenant.productCuttingSpec.findMany.mockResolvedValue([
        { productId: 'p1', kind: 'SHEET', stockLengthCm: 250, stockWidthCm: 120, defaultCutLengthCm: 30, defaultCutWidthCm: 20, defaultCutShapePolygon: null },
      ]);

      const result = await service.listStock(actor);

      expect(prisma.tenant.productCuttingSpec.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { productId: { in: ['p1'] } } }));
      expect(result.items).toEqual([
        expect.objectContaining({
          itemId: 'item1',
          cuttingSpec: { kind: 'SHEET', stockLengthCm: 250, stockWidthCm: 120, defaultCutLengthCm: 30, defaultCutWidthCm: 20, defaultCutShapePolygon: null },
        }),
      ]);
    });

    it("carries the picked item's own product documents (incl. a GLB model), for the cutting tool's GLB-dimension fallback", async () => {
      prisma.tenant.purchaseOrder.findMany.mockResolvedValue([
        {
          id: 'po1',
          orderDate: new Date('2026-10-01'),
          items: [
            { id: 'item1', productId: 'p1', articleSnapshot: 'A', productNameSnapshot: '-', qtyOrdered: 100, qtyReceived: 20, supplierReadyQty: 0 },
          ],
        },
      ]);
      filesService.listForEntities.mockResolvedValue({ p1: [{ id: 'f1', originalName: 'part.glb', downloadUrl: 'https://example.test/part.glb' }] });

      const result = await service.listStock(actor);

      expect(filesService.listForEntities).toHaveBeenCalledWith(expect.anything(), 'Product', ['p1'], ['PRODUCT_DOCUMENT']);
      expect(result.items).toEqual([expect.objectContaining({ itemId: 'item1', files: [{ id: 'f1', originalName: 'part.glb', downloadUrl: 'https://example.test/part.glb' }] })]);
    });
  });

  describe('updateSupplierReadyQty', () => {
    it('404s for an item not belonging to this supplier', async () => {
      prisma.tenant.purchaseOrderItem.findFirst.mockResolvedValue(null);
      await expect(service.updateSupplierReadyQty(actor, 'item1', { supplierReadyQty: 10 })).rejects.toThrow();
      expect(prisma.tenant.purchaseOrderItem.update).not.toHaveBeenCalled();
    });

    it('rejects declaring more ready than is actually still outstanding', async () => {
      prisma.tenant.purchaseOrderItem.findFirst.mockResolvedValue({ id: 'item1', qtyOrdered: 100, qtyReceived: 20 });
      await expect(service.updateSupplierReadyQty(actor, 'item1', { supplierReadyQty: 90 })).rejects.toThrow();
      expect(prisma.tenant.purchaseOrderItem.update).not.toHaveBeenCalled();
    });

    it('updates and audit-logs when within bounds', async () => {
      prisma.tenant.purchaseOrderItem.findFirst.mockResolvedValue({ id: 'item1', qtyOrdered: 100, qtyReceived: 20 });
      prisma.tenant.purchaseOrderItem.update.mockResolvedValue({ id: 'item1', supplierReadyQty: 50 });

      const result = await service.updateSupplierReadyQty(actor, 'item1', { supplierReadyQty: 50 });

      expect(prisma.tenant.purchaseOrderItem.update).toHaveBeenCalledWith({ where: { id: 'item1' }, data: { supplierReadyQty: 50 } });
      expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'purchase_order_item.supplier_ready_qty_updated' }));
      expect(result.supplierReadyQty).toBe(50);
    });
  });

  describe('finance (Фінанси)', () => {
    it('listFinanceDocuments delegates to FinanceService#listDocumentsForSupplier scoped to the caller\'s own supplierId', async () => {
      financeService.listDocumentsForSupplier.mockResolvedValue([{ id: 'doc1' }]);
      const result = await service.listFinanceDocuments(actor);
      expect(financeService.listDocumentsForSupplier).toHaveBeenCalledWith('s1');
      expect(result.items).toEqual([{ id: 'doc1' }]);
    });

    it('getFinanceDocument delegates with the caller\'s own supplierId', async () => {
      financeService.getDocumentForSupplier.mockResolvedValue({ id: 'doc1' });
      await service.getFinanceDocument(actor, 'doc1');
      expect(financeService.getDocumentForSupplier).toHaveBeenCalledWith('s1', 'doc1');
    });

    it('createFinanceDocument delegates with companyId/supplierId/supplierPortalUserId from the actor (purchaseOrderId stays optional, inside the dto)', async () => {
      financeService.createDocumentAsSupplier.mockResolvedValue({ id: 'doc1' });
      await service.createFinanceDocument(actor, { purchaseOrderId: 'po1', amount: 500 } as any);
      expect(financeService.createDocumentAsSupplier).toHaveBeenCalledWith('c1', 's1', 'spu1', { purchaseOrderId: 'po1', amount: 500 });
    });

    it('addFinancePayment delegates with companyId/supplierId/supplierPortalUserId from the actor', async () => {
      financeService.addPaymentAsSupplier.mockResolvedValue({ id: 'pay1' });
      await service.addFinancePayment(actor, 'doc1', { amount: 100 } as any);
      expect(financeService.addPaymentAsSupplier).toHaveBeenCalledWith('c1', 's1', 'spu1', 'doc1', { amount: 100 });
    });

    it('listFinanceDocumentFiles re-checks ownership (via getDocumentForSupplier) before listing FINANCE_DOCUMENT files', async () => {
      financeService.getDocumentForSupplier.mockResolvedValue({ id: 'doc1' });
      filesService.listForEntity.mockResolvedValue([{ id: 'f1' }]);
      const result = await service.listFinanceDocumentFiles(actor, 'doc1');
      expect(financeService.getDocumentForSupplier).toHaveBeenCalledWith('s1', 'doc1');
      expect(filesService.listForEntity).toHaveBeenCalledWith(expect.anything(), 'PurchaseOrderDocument', 'doc1', ['FINANCE_DOCUMENT']);
      expect(result).toEqual([{ id: 'f1' }]);
    });

    it('listFinanceDocumentFiles propagates the 404 when the document is not this supplier\'s own', async () => {
      financeService.getDocumentForSupplier.mockRejectedValue(new Error('not found'));
      await expect(service.listFinanceDocumentFiles(actor, 'doc-other')).rejects.toThrow();
      expect(filesService.listForEntity).not.toHaveBeenCalled();
    });

    it('createFinanceDocumentFileUpload pins domain/entityType/entityId server-side (never client-supplied)', async () => {
      financeService.getDocumentForSupplier.mockResolvedValue({ id: 'doc1' });
      filesService.createPresignedUpload.mockResolvedValue({ fileAssetId: 'f1', uploadUrl: 'https://example.test' });
      await service.createFinanceDocumentFileUpload(actor, 'doc1', { originalName: 'invoice.pdf', mimeType: 'application/pdf', sizeBytes: 100 });
      expect(filesService.createPresignedUpload).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ domain: 'FINANCE_DOCUMENT', entityType: 'PurchaseOrderDocument', entityId: 'doc1' }),
      );
    });

    it('confirmFinanceDocumentFileUpload 404s when the file does not belong to this document', async () => {
      financeService.getDocumentForSupplier.mockResolvedValue({ id: 'doc1' });
      prisma.tenant.fileAsset.findUnique.mockResolvedValue({ id: 'f1', entityType: 'PurchaseOrderDocument', entityId: 'doc-OTHER' });
      await expect(service.confirmFinanceDocumentFileUpload(actor, 'doc1', 'f1')).rejects.toThrow();
      expect(filesService.confirmUpload).not.toHaveBeenCalled();
    });

    it('confirmFinanceDocumentFileUpload confirms when the file does belong to this document', async () => {
      financeService.getDocumentForSupplier.mockResolvedValue({ id: 'doc1' });
      prisma.tenant.fileAsset.findUnique.mockResolvedValue({ id: 'f1', entityType: 'PurchaseOrderDocument', entityId: 'doc1' });
      filesService.confirmUpload.mockResolvedValue({ id: 'f1', uploadedAt: new Date() });
      await service.confirmFinanceDocumentFileUpload(actor, 'doc1', 'f1');
      expect(filesService.confirmUpload).toHaveBeenCalledWith(expect.anything(), 'f1');
    });
  });
});
