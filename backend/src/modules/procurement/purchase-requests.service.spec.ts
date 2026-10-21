import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PurchaseRequestsService } from './purchase-requests.service';

describe('PurchaseRequestsService', () => {
  let service: PurchaseRequestsService;
  let prisma: any;
  let audit: any;
  let purchaseOrdersService: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  const request = {
    id: 'pr1',
    status: 'DRAFT',
    supplierId: 's1',
    supplierNameSnapshot: 'Acme Supplier',
    comment: null,
    convertedPurchaseOrderId: null,
    items: [
      { id: 'item1', productId: 'p1', articleSnapshot: 'ABC', productNameSnapshot: 'Widget', qty: 10, expectedPrice: null },
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
        $queryRaw: jest.fn().mockResolvedValue([{ lastValue: 1 }]),
      },
    };
    audit = { record: jest.fn() };
    purchaseOrdersService = { create: jest.fn().mockResolvedValue({ id: 'po-new', status: 'ORDERED' }) };
    service = new PurchaseRequestsService(prisma, audit, purchaseOrdersService);
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
