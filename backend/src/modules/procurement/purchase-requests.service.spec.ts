import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PurchaseRequestsService } from './purchase-requests.service';

// Same technique as products.service.spec.ts's own prismaKnownError — a
// plain object with `code` set isn't enough, `instanceof
// PrismaClientKnownRequestError` needs the real prototype explicitly set.
function prismaKnownError(code: string) {
  const err = Object.assign(new Error('prisma error'), { code, clientVersion: '5.20.0', name: 'PrismaClientKnownRequestError' });
  Object.setPrototypeOf(err, Prisma.PrismaClientKnownRequestError.prototype);
  return err;
}

describe('PurchaseRequestsService', () => {
  let service: PurchaseRequestsService;
  let prisma: any;
  let audit: any;
  let purchaseOrdersService: any;
  let pdfRenderer: any;
  let pdfService: any;
  let filesService: any;
  let emailService: any;
  let supplierCatalogService: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  const request = {
    id: 'pr1',
    number: 'ЗП-2026-0001',
    status: 'DRAFT',
    supplierId: 's1',
    supplierNameSnapshot: 'Acme Supplier',
    comment: null,
    fromName: null,
    convertedPurchaseOrderId: null,
    createdAt: new Date('2026-10-21T00:00:00Z'),
    items: [
      { id: 'item1', productId: 'p1', articleSnapshot: 'ABC', productNameSnapshot: 'Widget', qty: 10, expectedPrice: null, attachedFileIds: [] },
    ],
  };

  beforeEach(() => {
    prisma = {
      tenant: {
        purchaseRequest: {
          create: jest.fn(),
          findUnique: jest.fn().mockResolvedValue({ ...request }),
          findMany: jest.fn(),
          count: jest.fn(),
          update: jest.fn(),
          delete: jest.fn(),
        },
        purchaseRequestItem: {
          create: jest.fn((args: any) => Promise.resolve({ id: 'new-item', ...args.data })),
          deleteMany: jest.fn(),
          update: jest.fn(),
          findMany: jest.fn().mockResolvedValue([]),
        },
        orderMaterialRequirement: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
        supplier: { findUnique: jest.fn() },
        supplierConnection: { findUnique: jest.fn().mockResolvedValue(null) },
        company: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', name: 'My Company' }) },
        companyBranding: { findUnique: jest.fn().mockResolvedValue(null) },
        $queryRaw: jest.fn().mockResolvedValue([{ lastValue: 1 }]),
      },
    };
    audit = { record: jest.fn() };
    purchaseOrdersService = { create: jest.fn().mockResolvedValue({ id: 'po-new', status: 'ORDERED' }) };
    pdfRenderer = { renderHtml: jest.fn().mockReturnValue('<html></html>') };
    pdfService = { generateAndStore: jest.fn().mockResolvedValue('file-1') };
    filesService = { listForEntities: jest.fn().mockResolvedValue({}), getDownloadUrl: jest.fn().mockResolvedValue({ downloadUrl: 'https://example.com/logo.png' }) };
    emailService = { send: jest.fn().mockResolvedValue({ sent: true }) };
    supplierCatalogService = { ensureCatalogEntries: jest.fn().mockResolvedValue(undefined) };
    service = new PurchaseRequestsService(prisma, audit, purchaseOrdersService, pdfRenderer, pdfService, filesService, emailService, supplierCatalogService);
  });

  describe('create', () => {
    it('creates the request with status DRAFT and an assigned number', async () => {
      prisma.tenant.purchaseRequest.create.mockResolvedValue({ id: 'pr1', status: 'DRAFT', number: 'ЗП-2026-0001' });

      const result = await service.create(user, {
        supplierNameSnapshot: 'Acme Supplier',
        items: [{ articleSnapshot: 'ABC', productNameSnapshot: 'Widget', qty: 10 }],
      });

      expect(prisma.tenant.purchaseRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'DRAFT', supplierNameSnapshot: 'Acme Supplier', number: 'ЗП-2026-0001' }),
        }),
      );
      expect(result.status).toBe('DRAFT');
    });
  });

  describe('saveItems — full bulk replace', () => {
    it('deletes all existing items then recreates them from the submitted array', async () => {
      await service.saveItems(user, 'pr1', { items: [{ articleSnapshot: 'NEW', productNameSnapshot: 'New part', qty: 3 }] });

      expect(prisma.tenant.purchaseRequestItem.deleteMany).toHaveBeenCalledWith({ where: { purchaseRequestId: 'pr1' } });
      expect(prisma.tenant.purchaseRequestItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ purchaseRequestId: 'pr1', articleSnapshot: 'NEW', qty: 3 }),
        }),
      );
    });

    it('rejects editing items once CONVERTED', async () => {
      prisma.tenant.purchaseRequest.findUnique.mockResolvedValue({ ...request, status: 'CONVERTED' });
      await expect(service.saveItems(user, 'pr1', { items: [{ articleSnapshot: 'X', productNameSnapshot: 'Y', qty: 1 }] })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.tenant.purchaseRequestItem.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('shortage-picker aggregation (requirementIds)', () => {
    beforeEach(() => {
      prisma.tenant.purchaseRequest.create.mockResolvedValue({ id: 'pr1', status: 'DRAFT', number: 'ЗП-2026-0001' });
    });

    it('stamps fulfillingPurchaseRequestItemId on every selected requirement when creating an item', async () => {
      prisma.tenant.orderMaterialRequirement.findMany.mockResolvedValue([
        { id: 'req1', customerOrderId: 'co1', fulfillingPurchaseRequestItemId: null },
        { id: 'req2', customerOrderId: 'co2', fulfillingPurchaseRequestItemId: null },
      ]);

      await service.create(user, {
        supplierNameSnapshot: 'Acme Supplier',
        items: [{ articleSnapshot: 'ABC', productNameSnapshot: 'Widget', qty: 10, requirementIds: ['req1', 'req2'] }],
      });

      expect(prisma.tenant.orderMaterialRequirement.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['req1', 'req2'] } },
        data: { fulfillingPurchaseRequestItemId: 'new-item' },
      });
    });

    it('rejects a requirement that could not be found', async () => {
      prisma.tenant.orderMaterialRequirement.findMany.mockResolvedValue([{ id: 'req1', fulfillingPurchaseRequestItemId: null }]);
      await expect(
        service.create(user, {
          supplierNameSnapshot: 'Acme Supplier',
          items: [{ articleSnapshot: 'ABC', productNameSnapshot: 'Widget', qty: 10, requirementIds: ['req1', 'req-missing'] }],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.tenant.orderMaterialRequirement.updateMany).not.toHaveBeenCalled();
    });

    it('rejects claiming a requirement already part of another LIVE заявка', async () => {
      prisma.tenant.orderMaterialRequirement.findMany.mockResolvedValue([{ id: 'req1', fulfillingPurchaseRequestItemId: 'other-item' }]);
      prisma.tenant.purchaseRequestItem.findMany = jest.fn().mockResolvedValue([
        { id: 'other-item', purchaseRequest: { status: 'DRAFT', number: 'ЗП-2026-0002' } },
      ]);

      await expect(
        service.create(user, {
          supplierNameSnapshot: 'Acme Supplier',
          items: [{ articleSnapshot: 'ABC', productNameSnapshot: 'Widget', qty: 10, requirementIds: ['req1'] }],
        }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.tenant.orderMaterialRequirement.updateMany).not.toHaveBeenCalled();
    });

    it('allows re-claiming a requirement whose only existing claimant was CANCELLED', async () => {
      prisma.tenant.orderMaterialRequirement.findMany.mockResolvedValue([{ id: 'req1', fulfillingPurchaseRequestItemId: 'other-item' }]);
      prisma.tenant.purchaseRequestItem.findMany = jest.fn().mockResolvedValue([
        { id: 'other-item', purchaseRequest: { status: 'CANCELLED', number: 'ЗП-2026-0002' } },
      ]);

      await service.create(user, {
        supplierNameSnapshot: 'Acme Supplier',
        items: [{ articleSnapshot: 'ABC', productNameSnapshot: 'Widget', qty: 10, requirementIds: ['req1'] }],
      });

      expect(prisma.tenant.orderMaterialRequirement.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['req1'] } },
        data: { fulfillingPurchaseRequestItemId: 'new-item' },
      });
    });
  });

  describe('update — including the editable document number', () => {
    it('persists an edited number alongside other header fields', async () => {
      await service.update(user, 'pr1', { number: 'ЗП-2026-0001-A' } as any);
      expect(prisma.tenant.purchaseRequest.update).toHaveBeenCalledWith({
        where: { id: 'pr1' },
        data: { number: 'ЗП-2026-0001-A' },
      });
    });

    it('surfaces a duplicate number (P2002) as a friendly ConflictException', async () => {
      prisma.tenant.purchaseRequest.update.mockRejectedValue(prismaKnownError('P2002'));
      await expect(service.update(user, 'pr1', { number: 'ЗП-2026-0001' } as any)).rejects.toThrow(ConflictException);
    });

    it('rejects editing a CONVERTED request', async () => {
      prisma.tenant.purchaseRequest.findUnique.mockResolvedValue({ ...request, status: 'CONVERTED' });
      await expect(service.update(user, 'pr1', { number: 'X' } as any)).rejects.toThrow(BadRequestException);
      expect(prisma.tenant.purchaseRequest.update).not.toHaveBeenCalled();
    });
  });

  describe('send', () => {
    it('flips status to SENT and sets sentAt', async () => {
      prisma.tenant.purchaseRequest.update.mockResolvedValue({ ...request, status: 'SENT', sentAt: new Date() });
      await service.send(user, 'pr1');
      expect(prisma.tenant.purchaseRequest.update).toHaveBeenCalledWith({
        where: { id: 'pr1' },
        data: { status: 'SENT', sentAt: expect.any(Date) },
      });
    });

    it.each(['CONVERTED', 'CANCELLED'])('rejects sending a %s request', async (status) => {
      prisma.tenant.purchaseRequest.findUnique.mockResolvedValue({ ...request, status });
      await expect(service.send(user, 'pr1')).rejects.toThrow(BadRequestException);
    });

    describe('supplier-portal notification', () => {
      beforeEach(() => {
        prisma.tenant.purchaseRequest.update.mockResolvedValue({ ...request, status: 'SENT', sentAt: new Date() });
      });

      it('emails the supplier portal user when the connection is ACTIVE and the account is active', async () => {
        prisma.tenant.supplierConnection.findUnique.mockResolvedValue({
          status: 'ACTIVE',
          supplierOrganization: { portalUser: { email: 'supplier@example.com', active: true } },
        });

        await service.send(user, 'pr1');

        expect(emailService.send).toHaveBeenCalledWith('supplier@example.com', expect.any(String), expect.stringContaining('ЗП-2026-0001'));
      });

      it('does not email when the connection is PENDING', async () => {
        prisma.tenant.supplierConnection.findUnique.mockResolvedValue({
          status: 'PENDING',
          supplierOrganization: { portalUser: { email: 'supplier@example.com', active: true } },
        });

        await service.send(user, 'pr1');

        expect(emailService.send).not.toHaveBeenCalled();
      });

      it('does not email when there is no connection at all', async () => {
        prisma.tenant.supplierConnection.findUnique.mockResolvedValue(null);

        await service.send(user, 'pr1');

        expect(emailService.send).not.toHaveBeenCalled();
      });

      it('does not email, and does not even look up a connection, for a free-text-only supplier (no supplierId)', async () => {
        prisma.tenant.purchaseRequest.findUnique.mockResolvedValue({ ...request, supplierId: null });
        prisma.tenant.purchaseRequest.update.mockResolvedValue({ ...request, supplierId: null, status: 'SENT', sentAt: new Date() });

        await service.send(user, 'pr1');

        expect(prisma.tenant.supplierConnection.findUnique).not.toHaveBeenCalled();
        expect(emailService.send).not.toHaveBeenCalled();
      });

      it('still succeeds (send is never blocked) when the notification lookup throws', async () => {
        prisma.tenant.supplierConnection.findUnique.mockRejectedValue(new Error('db hiccup'));

        await expect(service.send(user, 'pr1')).resolves.toBeDefined();
      });
    });

    describe('supplier catalog population', () => {
      beforeEach(() => {
        prisma.tenant.purchaseRequest.update.mockResolvedValue({ ...request, status: 'SENT', sentAt: new Date() });
      });

      it("ensures catalog entries for this request's own supplierId/productIds", async () => {
        prisma.tenant.purchaseRequestItem.findMany.mockResolvedValue([{ productId: 'p1' }, { productId: null }]);

        await service.send(user, 'pr1');

        expect(prisma.tenant.purchaseRequestItem.findMany).toHaveBeenCalledWith({ where: { purchaseRequestId: 'pr1' } });
        expect(supplierCatalogService.ensureCatalogEntries).toHaveBeenCalledWith(user, 's1', ['p1', null]);
      });

      it('still succeeds (send is never blocked) when the item lookup throws', async () => {
        prisma.tenant.purchaseRequestItem.findMany.mockRejectedValue(new Error('db hiccup'));

        await expect(service.send(user, 'pr1')).resolves.toBeDefined();
      });
    });
  });

  describe('cancel', () => {
    it('flips status to CANCELLED', async () => {
      await service.cancel(user, 'pr1');
      expect(prisma.tenant.purchaseRequest.update).toHaveBeenCalledWith({ where: { id: 'pr1' }, data: { status: 'CANCELLED' } });
    });
  });

  describe('convertToOrder', () => {
    it('creates a real PurchaseOrder from the request\'s current items, then marks the request CONVERTED', async () => {
      const result = await service.convertToOrder(user, 'pr1');

      expect(purchaseOrdersService.create).toHaveBeenCalledWith(
        user,
        expect.objectContaining({
          supplierId: 's1',
          supplierNameSnapshot: 'Acme Supplier',
          items: [expect.objectContaining({ productId: 'p1', articleSnapshot: 'ABC', qtyOrdered: 10 })],
        }),
      );
      expect(prisma.tenant.purchaseRequest.update).toHaveBeenCalledWith({
        where: { id: 'pr1' },
        data: { status: 'CONVERTED', convertedPurchaseOrderId: 'po-new' },
      });
      expect(result.purchaseOrder.id).toBe('po-new');
    });

    it('rejects a second conversion attempt', async () => {
      prisma.tenant.purchaseRequest.findUnique.mockResolvedValue({ ...request, status: 'CONVERTED', convertedPurchaseOrderId: 'po-existing' });
      await expect(service.convertToOrder(user, 'pr1')).rejects.toThrow(ConflictException);
      expect(purchaseOrdersService.create).not.toHaveBeenCalled();
    });

    it('rejects converting a CANCELLED request', async () => {
      prisma.tenant.purchaseRequest.findUnique.mockResolvedValue({ ...request, status: 'CANCELLED' });
      await expect(service.convertToOrder(user, 'pr1')).rejects.toThrow(ConflictException);
    });

    it("prefers the supplier's quoted price over staff's expectedPrice when both are set", async () => {
      prisma.tenant.purchaseRequest.findUnique.mockResolvedValue({
        ...request,
        items: [{ ...request.items[0], expectedPrice: 50, supplierQuotedPrice: 42 }],
      });
      await service.convertToOrder(user, 'pr1');
      expect(purchaseOrdersService.create).toHaveBeenCalledWith(
        user,
        expect.objectContaining({ items: [expect.objectContaining({ expectedPrice: 42 })] }),
      );
    });

    it('falls back to expectedPrice when the supplier has not quoted this line', async () => {
      prisma.tenant.purchaseRequest.findUnique.mockResolvedValue({
        ...request,
        items: [{ ...request.items[0], expectedPrice: 50, supplierQuotedPrice: null }],
      });
      await service.convertToOrder(user, 'pr1');
      expect(purchaseOrdersService.create).toHaveBeenCalledWith(
        user,
        expect.objectContaining({ items: [expect.objectContaining({ expectedPrice: 50 })] }),
      );
    });

    it('fans out an aggregated line into one PurchaseOrder per distinct customer order, split proportionally by requiredQty', async () => {
      prisma.tenant.orderMaterialRequirement.findMany.mockResolvedValue([
        { id: 'req1', customerOrderId: 'co1', requiredQty: 6, fulfillingPurchaseRequestItemId: 'item1', customerOrder: { deadline: new Date('2026-12-01') } },
        { id: 'req2', customerOrderId: 'co2', requiredQty: 4, fulfillingPurchaseRequestItemId: 'item1', customerOrder: { deadline: new Date('2026-11-15') } },
      ]);
      purchaseOrdersService.create = jest
        .fn()
        .mockResolvedValueOnce({ id: 'po-co1' })
        .mockResolvedValueOnce({ id: 'po-co2' });

      const result = await service.convertToOrder(user, 'pr1');

      expect(purchaseOrdersService.create).toHaveBeenCalledTimes(2);
      expect(purchaseOrdersService.create).toHaveBeenCalledWith(
        user,
        expect.objectContaining({
          sourceCustomerOrderId: 'co1',
          items: [expect.objectContaining({ qtyOrdered: 6, sourceRequirementId: 'req1', originatingPurchaseRequestItemId: 'item1' })],
        }),
      );
      // co2's deadline (2026-11-15) is earlier/more urgent than co1's (2026-12-01) — co2 absorbs the rounding remainder.
      expect(purchaseOrdersService.create).toHaveBeenCalledWith(
        user,
        expect.objectContaining({
          sourceCustomerOrderId: 'co2',
          items: [expect.objectContaining({ qtyOrdered: 4, sourceRequirementId: 'req2', originatingPurchaseRequestItemId: 'item1' })],
        }),
      );
      expect(prisma.tenant.purchaseRequest.update).toHaveBeenCalledWith({
        where: { id: 'pr1' },
        data: { status: 'CONVERTED', convertedPurchaseOrderId: 'po-co1' },
      });
      expect(result.purchaseOrders).toEqual([{ id: 'po-co1' }, { id: 'po-co2' }]);
    });

    it('leaves expectedPrice undefined when neither a quote nor an expected price was ever set', async () => {
      prisma.tenant.purchaseRequest.findUnique.mockResolvedValue({
        ...request,
        items: [{ ...request.items[0], expectedPrice: null, supplierQuotedPrice: null }],
      });
      await service.convertToOrder(user, 'pr1');
      expect(purchaseOrdersService.create).toHaveBeenCalledWith(
        user,
        expect.objectContaining({ items: [expect.objectContaining({ expectedPrice: undefined })] }),
      );
    });
  });

  describe('generatePdf', () => {
    it('renders HTML from the current request state, stores it, and persists pdfFileId', async () => {
      await service.generatePdf(user, 'pr1');

      expect(pdfRenderer.renderHtml).toHaveBeenCalledWith(
        expect.objectContaining({
          number: 'ЗП-2026-0001',
          fromName: '',
          fromLogoUrl: null,
          supplier: { name: 'Acme Supplier' },
          items: [expect.objectContaining({ articleSnapshot: 'ABC', qty: 10, photoUrl: null })],
        }),
      );
      expect(pdfService.generateAndStore).toHaveBeenCalledWith(user, expect.objectContaining({ purchaseRequestId: 'pr1', purchaseRequestNumber: 'ЗП-2026-0001', attachments: [] }));
      expect(prisma.tenant.purchaseRequest.update).toHaveBeenCalledWith({
        where: { id: 'pr1' },
        data: { pdfFileId: 'file-1' },
        include: { items: true },
      });
    });

    it('uses PurchaseRequest.fromName when set — no default to the company name', async () => {
      prisma.tenant.purchaseRequest.findUnique.mockResolvedValue({ ...request, fromName: 'Custom Sender LLC' });
      await service.generatePdf(user, 'pr1');
      expect(pdfRenderer.renderHtml).toHaveBeenCalledWith(expect.objectContaining({ fromName: 'Custom Sender LLC' }));
    });

    it('resolves the branding print logo to a presigned URL for fromLogoUrl', async () => {
      prisma.tenant.companyBranding.findUnique.mockResolvedValue({ companyId: 'c1', printLogoFileId: 'logo-1' });
      await service.generatePdf(user, 'pr1');
      expect(filesService.getDownloadUrl).toHaveBeenCalledWith(user, 'logo-1');
      expect(pdfRenderer.renderHtml).toHaveBeenCalledWith(expect.objectContaining({ fromLogoUrl: 'https://example.com/logo.png' }));
    });

    it('resolves each linked product\'s live PRODUCT_PHOTO for the item photo column', async () => {
      filesService.listForEntities.mockResolvedValue({ p1: [{ downloadUrl: 'https://example.com/p1.jpg' }] });
      await service.generatePdf(user, 'pr1');
      expect(filesService.listForEntities).toHaveBeenCalledWith(user, 'Product', ['p1'], ['PRODUCT_PHOTO']);
      expect(pdfRenderer.renderHtml).toHaveBeenCalledWith(
        expect.objectContaining({ items: [expect.objectContaining({ photoUrl: 'https://example.com/p1.jpg' })] }),
      );
    });

    it('builds one merge attachment per selected file id', async () => {
      prisma.tenant.purchaseRequest.findUnique.mockResolvedValue({
        ...request,
        items: [{ ...request.items[0], attachedFileIds: ['f1', 'f2'] }],
      });
      await service.generatePdf(user, 'pr1');
      expect(pdfService.generateAndStore).toHaveBeenCalledWith(
        user,
        expect.objectContaining({ attachments: [{ fileAssetId: 'f1' }, { fileAssetId: 'f2' }] }),
      );
    });

    it('allows generating a PDF for a DRAFT request (no status gate, unlike Quotation send())', async () => {
      prisma.tenant.purchaseRequest.update.mockResolvedValue({ ...request, pdfFileId: 'file-1' });
      await expect(service.generatePdf(user, 'pr1')).resolves.toEqual(expect.objectContaining({ pdfFileId: 'file-1' }));
    });

    it('uses supplierNameSnapshot for the supplier block — no linked Supplier record is fetched', async () => {
      prisma.tenant.purchaseRequest.findUnique.mockResolvedValue({ ...request, supplierId: null });
      await service.generatePdf(user, 'pr1');
      expect(prisma.tenant.supplier.findUnique).not.toHaveBeenCalled();
      expect(pdfRenderer.renderHtml).toHaveBeenCalledWith(expect.objectContaining({ supplier: { name: 'Acme Supplier' } }));
    });
  });

  describe('remove', () => {
    it('deletes a DRAFT request', async () => {
      await service.remove(user, 'pr1');
      expect(prisma.tenant.purchaseRequest.delete).toHaveBeenCalledWith({ where: { id: 'pr1' } });
    });

    it.each(['SENT', 'CONVERTED', 'CANCELLED'])('rejects deleting a %s request', async (status) => {
      prisma.tenant.purchaseRequest.findUnique.mockResolvedValue({ ...request, status });
      await expect(service.remove(user, 'pr1')).rejects.toThrow(BadRequestException);
      expect(prisma.tenant.purchaseRequest.delete).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('rejects an unknown id', async () => {
      prisma.tenant.purchaseRequest.findUnique.mockResolvedValue(null);
      await expect(service.findOne(user, 'nope')).rejects.toThrow(NotFoundException);
    });
  });
});
