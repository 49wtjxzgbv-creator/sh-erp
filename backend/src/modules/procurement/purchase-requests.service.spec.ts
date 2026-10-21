import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PurchaseRequestsService } from './purchase-requests.service';

describe('PurchaseRequestsService', () => {
  let service: PurchaseRequestsService;
  let prisma: any;
  let audit: any;
  let purchaseOrdersService: any;
  let pdfRenderer: any;
  let pdfService: any;
  let filesService: any;
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
        purchaseRequestItem: { deleteMany: jest.fn(), createMany: jest.fn() },
        company: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', name: 'My Company' }) },
        supplier: { findUnique: jest.fn().mockResolvedValue({ id: 's1', name: 'Acme Supplier', contactPerson: null, phone: null, email: null }) },
        companyBranding: { findUnique: jest.fn().mockResolvedValue(null) },
        fileAsset: { findMany: jest.fn().mockResolvedValue([]) },
        $queryRaw: jest.fn().mockResolvedValue([{ lastValue: 1 }]),
      },
    };
    audit = { record: jest.fn() };
    purchaseOrdersService = { create: jest.fn().mockResolvedValue({ id: 'po-new', status: 'ORDERED' }) };
    pdfRenderer = { renderHtml: jest.fn().mockReturnValue('<html></html>') };
    pdfService = { generateAndStore: jest.fn().mockResolvedValue('file-1') };
    filesService = { listForEntities: jest.fn().mockResolvedValue({}), getDownloadUrl: jest.fn().mockResolvedValue({ downloadUrl: 'https://example.com/logo.png' }) };
    service = new PurchaseRequestsService(prisma, audit, purchaseOrdersService, pdfRenderer, pdfService, filesService);
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
      expect(prisma.tenant.purchaseRequestItem.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({ purchaseRequestId: 'pr1', articleSnapshot: 'NEW', qty: 3 })],
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

  describe('send', () => {
    it('flips status to SENT and sets sentAt', async () => {
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
  });

  describe('generatePdf', () => {
    it('renders HTML from the current request state, stores it, and persists pdfFileId', async () => {
      await service.generatePdf(user, 'pr1');

      expect(pdfRenderer.renderHtml).toHaveBeenCalledWith(
        expect.objectContaining({
          number: 'ЗП-2026-0001',
          fromName: 'My Company',
          fromLogoUrl: null,
          supplier: expect.objectContaining({ name: 'Acme Supplier' }),
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

    it('prefers PurchaseRequest.fromName over the company name when set', async () => {
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

    it('builds one merge attachment per selected file id, with a heading naming the line and the file', async () => {
      prisma.tenant.purchaseRequest.findUnique.mockResolvedValue({
        ...request,
        items: [{ ...request.items[0], attachedFileIds: ['f1', 'f2'] }],
      });
      prisma.tenant.fileAsset.findMany.mockResolvedValue([
        { id: 'f1', originalName: 'drawing.pdf' },
        { id: 'f2', originalName: 'spec.png' },
      ]);
      await service.generatePdf(user, 'pr1');
      expect(pdfService.generateAndStore).toHaveBeenCalledWith(
        user,
        expect.objectContaining({
          attachments: [
            { fileAssetId: 'f1', heading: 'Поз. 1 — ABC — drawing.pdf' },
            { fileAssetId: 'f2', heading: 'Поз. 1 — ABC — spec.png' },
          ],
        }),
      );
    });

    it('allows generating a PDF for a DRAFT request (no status gate, unlike Quotation send())', async () => {
      prisma.tenant.purchaseRequest.update.mockResolvedValue({ ...request, pdfFileId: 'file-1' });
      await expect(service.generatePdf(user, 'pr1')).resolves.toEqual(expect.objectContaining({ pdfFileId: 'file-1' }));
    });

    it('falls back to supplierNameSnapshot with null contact fields when the request has no linked supplierId', async () => {
      prisma.tenant.purchaseRequest.findUnique.mockResolvedValue({ ...request, supplierId: null });
      await service.generatePdf(user, 'pr1');
      expect(prisma.tenant.supplier.findUnique).not.toHaveBeenCalled();
      expect(pdfRenderer.renderHtml).toHaveBeenCalledWith(
        expect.objectContaining({ supplier: { name: 'Acme Supplier', contactPerson: null, phone: null, email: null } }),
      );
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
