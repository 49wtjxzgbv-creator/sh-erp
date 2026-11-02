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
        user: { findUnique: jest.fn().mockResolvedValue({ id: 'staff1', email: 'staff@example.com' }) },
      },
    };
    auditService = { record: jest.fn() };
    emailService = { send: jest.fn().mockResolvedValue({ sent: true }) };
    filesService = { listForEntities: jest.fn().mockResolvedValue({}) };
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
          { id: 'item1', productId: 'p1', articleSnapshot: 'ABC' },
          { id: 'item2', productId: null, articleSnapshot: 'XYZ' },
        ],
      });
      filesService.listForEntities.mockResolvedValue({ p1: [{ downloadUrl: 'https://example.com/p1.jpg' }] });

      const result = await service.getPurchaseRequest(actor, 'pr1');

      expect(filesService.listForEntities).toHaveBeenCalledWith(expect.anything(), 'Product', ['p1'], ['PRODUCT_PHOTO']);
      expect(result.items).toEqual([
        { id: 'item1', productId: 'p1', articleSnapshot: 'ABC', photoUrl: 'https://example.com/p1.jpg' },
        { id: 'item2', productId: null, articleSnapshot: 'XYZ', photoUrl: null },
      ]);
    });

    it('skips the photo lookup entirely when no line has a productId', async () => {
      prisma.tenant.purchaseRequest.findFirst.mockResolvedValue({ id: 'pr1', status: 'SENT', items: [{ id: 'item1', productId: null }] });

      await service.getPurchaseRequest(actor, 'pr1');

      expect(filesService.listForEntities).not.toHaveBeenCalled();
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
      items: [{ id: 'item1' }, { id: 'item2' }],
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
});
