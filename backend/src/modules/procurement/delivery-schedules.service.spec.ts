import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DeliverySchedulesService } from './delivery-schedules.service';

/**
 * Phase 1 (2026-08-21) — Delivery Schedule state machine. These tests cover
 * exactly what the plan calls out: quantity integrity (no gain/loss on
 * propose, no negative/zero lines, no exceeding qtyOrdered), the single
 * "current version" pointer only ever moving atomically, at most one
 * PROPOSED version per item, reject leaving the current version untouched,
 * and every action producing an audit event.
 */
describe('DeliverySchedulesService', () => {
  let service: DeliverySchedulesService;
  let prisma: any;
  let audit: any;

  const p2002 = () => new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });

  beforeEach(() => {
    prisma = {
      tenant: {
        purchaseOrderItem: { findUnique: jest.fn(), updateMany: jest.fn() },
        deliverySchedule: { create: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
      },
    };
    audit = { record: jest.fn() };
    service = new DeliverySchedulesService(prisma, audit);
  });

  describe('createFirstVersion', () => {
    it('rejects when the item does not exist', async () => {
      prisma.tenant.purchaseOrderItem.findUnique.mockResolvedValue(null);
      await expect(service.createFirstVersion('c1', 'u1', 'item1', [{ date: new Date(), qty: 100 }])).rejects.toThrow(NotFoundException);
    });

    it('rejects when the item already has a current schedule', async () => {
      prisma.tenant.purchaseOrderItem.findUnique.mockResolvedValue({ id: 'item1', qtyOrdered: 100, currentDeliveryScheduleId: 'sched-existing' });
      await expect(service.createFirstVersion('c1', 'u1', 'item1', [{ date: new Date(), qty: 100 }])).rejects.toThrow(ConflictException);
      expect(prisma.tenant.deliverySchedule.create).not.toHaveBeenCalled();
    });

    it('rejects a zero/negative line quantity', async () => {
      prisma.tenant.purchaseOrderItem.findUnique.mockResolvedValue({ id: 'item1', qtyOrdered: 100, currentDeliveryScheduleId: null });
      await expect(service.createFirstVersion('c1', 'u1', 'item1', [{ date: new Date(), qty: 0 }])).rejects.toThrow(BadRequestException);
    });

    it('rejects a total exceeding qtyOrdered', async () => {
      prisma.tenant.purchaseOrderItem.findUnique.mockResolvedValue({ id: 'item1', qtyOrdered: 100, currentDeliveryScheduleId: null });
      await expect(
        service.createFirstVersion('c1', 'u1', 'item1', [
          { date: new Date(), qty: 60 },
          { date: new Date(), qty: 60 },
        ]),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates version 1, links the pointer atomically, and records an audit event', async () => {
      prisma.tenant.purchaseOrderItem.findUnique.mockResolvedValue({ id: 'item1', qtyOrdered: 5000, currentDeliveryScheduleId: null });
      prisma.tenant.deliverySchedule.create.mockResolvedValue({ id: 'sched1', versionNumber: 1, status: 'PENDING', lines: [] });
      prisma.tenant.purchaseOrderItem.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.createFirstVersion('c1', 'u1', 'item1', [{ date: new Date('2026-08-25'), qty: 5000 }]);

      expect(prisma.tenant.purchaseOrderItem.updateMany).toHaveBeenCalledWith({
        where: { id: 'item1', currentDeliveryScheduleId: null },
        data: { currentDeliveryScheduleId: 'sched1' },
      });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'purchase_order.schedule_created', entityId: 'sched1' }));
      expect(result.id).toBe('sched1');
    });

    // Regression test for a real production bug: DeliveryScheduleLine's FK to
    // DeliverySchedule is a plain single-column FK (unlike PurchaseOrderItem's
    // composite FK to PurchaseOrder), so Prisma cannot infer companyId for a
    // nested `lines.create` entry — tenantScopingExtension only stamps the
    // top-level `data`, never nested relation creates. Without an explicit
    // companyId on each line, a real (unmocked) Prisma client throws
    // `PrismaClientValidationError: Argument 'company' is missing` — this
    // mock-based test can't reproduce that runtime error, but it does pin the
    // call shape so the explicit companyId can never silently regress.
    it('stamps companyId explicitly onto every nested delivery-schedule-line create', async () => {
      prisma.tenant.purchaseOrderItem.findUnique.mockResolvedValue({ id: 'item1', qtyOrdered: 5000, currentDeliveryScheduleId: null });
      prisma.tenant.deliverySchedule.create.mockResolvedValue({ id: 'sched1', versionNumber: 1, status: 'PENDING', lines: [] });
      prisma.tenant.purchaseOrderItem.updateMany.mockResolvedValue({ count: 1 });

      await service.createFirstVersion('c1', 'u1', 'item1', [
        { date: new Date('2026-08-25'), qty: 2000 },
        { date: new Date('2026-08-28'), qty: 3000 },
      ]);

      expect(prisma.tenant.deliverySchedule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lines: {
              create: [
                { date: new Date('2026-08-25'), qty: 2000, companyId: 'c1' },
                { date: new Date('2026-08-28'), qty: 3000, companyId: 'c1' },
              ],
            },
          }),
        }),
      );
    });

    it('translates a P2002 on create (two concurrent first-version creates) into a conflict', async () => {
      prisma.tenant.purchaseOrderItem.findUnique.mockResolvedValue({ id: 'item1', qtyOrdered: 100, currentDeliveryScheduleId: null });
      prisma.tenant.deliverySchedule.create.mockRejectedValue(p2002());
      await expect(service.createFirstVersion('c1', 'u1', 'item1', [{ date: new Date(), qty: 100 }])).rejects.toThrow(ConflictException);
    });

    it('rejects (conflict) when the pointer-link updateMany matches zero rows (lost a race after create)', async () => {
      prisma.tenant.purchaseOrderItem.findUnique.mockResolvedValue({ id: 'item1', qtyOrdered: 100, currentDeliveryScheduleId: null });
      prisma.tenant.deliverySchedule.create.mockResolvedValue({ id: 'sched1', versionNumber: 1, status: 'PENDING', lines: [] });
      prisma.tenant.purchaseOrderItem.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.createFirstVersion('c1', 'u1', 'item1', [{ date: new Date(), qty: 100 }])).rejects.toThrow(ConflictException);
    });
  });

  describe('confirmAsIs', () => {
    it('rejects a schedule that is not PENDING', async () => {
      await expect(service.confirmAsIs('c1', 'sp1', { id: 's1', purchaseOrderItemId: 'item1', status: 'CONFIRMED' })).rejects.toThrow(NotFoundException);
    });

    it('flips PENDING to CONFIRMED and records an audit event with the supplier portal user id', async () => {
      prisma.tenant.deliverySchedule.update.mockResolvedValue({ id: 's1', status: 'CONFIRMED', lines: [] });
      const result = await service.confirmAsIs('c1', 'sp1', { id: 's1', purchaseOrderItemId: 'item1', status: 'PENDING' });

      expect(prisma.tenant.deliverySchedule.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { status: 'CONFIRMED', respondedById: 'sp1', respondedAt: expect.any(Date) },
        include: { lines: true },
      });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'purchase_order.schedule_confirmed', metadata: expect.objectContaining({ supplierPortalUserId: 'sp1' }) }));
      expect(result.status).toBe('CONFIRMED');
    });
  });

  describe('propose — quantity integrity is the whole point', () => {
    const pendingSchedule = { id: 's1', purchaseOrderItemId: 'item1', status: 'PENDING', lines: [{ qty: 2000 }, { qty: 2000 }, { qty: 1000 }] }; // total 5000

    it('rejects when the target schedule is not PENDING', async () => {
      await expect(
        service.propose('c1', 'sp1', { ...pendingSchedule, status: 'CONFIRMED' }, [{ date: new Date(), qty: 5000 }]),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects when a proposal is already pending for this item', async () => {
      prisma.tenant.deliverySchedule.findFirst.mockResolvedValue({ id: 'existing-proposal' });
      await expect(service.propose('c1', 'sp1', pendingSchedule, [{ date: new Date(), qty: 5000 }])).rejects.toThrow(ConflictException);
      expect(prisma.tenant.deliverySchedule.create).not.toHaveBeenCalled();
    });

    it('rejects a zero/negative proposed line', async () => {
      prisma.tenant.deliverySchedule.findFirst.mockResolvedValue(null);
      await expect(service.propose('c1', 'sp1', pendingSchedule, [{ date: new Date(), qty: 0 }])).rejects.toThrow(BadRequestException);
    });

    it('rejects a proposal whose total is LESS than the quantity it replaces (silently losing quantity)', async () => {
      prisma.tenant.deliverySchedule.findFirst.mockResolvedValue(null);
      await expect(service.propose('c1', 'sp1', pendingSchedule, [{ date: new Date(), qty: 4000 }])).rejects.toThrow(BadRequestException);
    });

    it('rejects a proposal whose total is MORE than the quantity it replaces (silently gaining quantity)', async () => {
      prisma.tenant.deliverySchedule.findFirst.mockResolvedValue(null);
      await expect(service.propose('c1', 'sp1', pendingSchedule, [{ date: new Date(), qty: 6000 }])).rejects.toThrow(BadRequestException);
    });

    it('accepts a split whose total exactly matches (2000/1500/1500 replacing 5000) and links previousVersionId', async () => {
      prisma.tenant.deliverySchedule.findFirst.mockResolvedValue(null);
      prisma.tenant.deliverySchedule.create.mockResolvedValue({ id: 's2', versionNumber: 2, status: 'PROPOSED', lines: [] });

      const result = await service.propose('c1', 'sp1', pendingSchedule, [
        { date: new Date('2026-08-25'), qty: 2000 },
        { date: new Date('2026-08-28'), qty: 1500 },
        { date: new Date('2026-09-01'), qty: 1500 },
      ]);

      expect(prisma.tenant.deliverySchedule.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ previousVersionId: 's1', status: 'PROPOSED', versionNumber: 1 }) }),
      );
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'purchase_order.schedule_proposed', entityId: 's2' }));
      expect(result.id).toBe('s2');
    });

    // Same regression coverage as createFirstVersion's own test — propose()
    // has the identical nested lines.create pattern and the identical bug.
    it('stamps companyId explicitly onto every nested delivery-schedule-line create', async () => {
      prisma.tenant.deliverySchedule.findFirst.mockResolvedValue(null);
      prisma.tenant.deliverySchedule.create.mockResolvedValue({ id: 's2', versionNumber: 2, status: 'PROPOSED', lines: [] });

      await service.propose('c1', 'sp1', pendingSchedule, [
        { date: new Date('2026-08-25'), qty: 2000 },
        { date: new Date('2026-08-28'), qty: 1500 },
        { date: new Date('2026-09-01'), qty: 1500 },
      ]);

      expect(prisma.tenant.deliverySchedule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lines: {
              create: [
                { date: new Date('2026-08-25'), qty: 2000, companyId: 'c1' },
                { date: new Date('2026-08-28'), qty: 1500, companyId: 'c1' },
                { date: new Date('2026-09-01'), qty: 1500, companyId: 'c1' },
              ],
            },
          }),
        }),
      );
    });

    it('translates a P2002 on create (two concurrent proposals, partial unique index) into a conflict', async () => {
      prisma.tenant.deliverySchedule.findFirst.mockResolvedValue(null);
      prisma.tenant.deliverySchedule.create.mockRejectedValue(p2002());
      await expect(service.propose('c1', 'sp1', pendingSchedule, [{ date: new Date(), qty: 5000 }])).rejects.toThrow(ConflictException);
    });
  });

  describe('accept — atomic pointer move + supersede, all or nothing', () => {
    it('rejects a schedule that is not PROPOSED', async () => {
      await expect(service.accept('c1', 'u1', { id: 's2', purchaseOrderItemId: 'item1', status: 'CONFIRMED' }, 's1')).rejects.toThrow(NotFoundException);
      expect(prisma.tenant.purchaseOrderItem.updateMany).not.toHaveBeenCalled();
    });

    it('rejects (conflict) when the pointer moved concurrently, and never flips either schedule\'s status', async () => {
      prisma.tenant.purchaseOrderItem.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.accept('c1', 'u1', { id: 's2', purchaseOrderItemId: 'item1', status: 'PROPOSED' }, 's1')).rejects.toThrow(ConflictException);
      expect(prisma.tenant.deliverySchedule.update).not.toHaveBeenCalled();
    });

    it('supersedes the old current version, confirms the new one, moves the pointer, and audits — all in the expected order', async () => {
      prisma.tenant.purchaseOrderItem.updateMany.mockResolvedValue({ count: 1 });
      prisma.tenant.deliverySchedule.update.mockResolvedValueOnce({ id: 's1', status: 'SUPERSEDED' }).mockResolvedValueOnce({ id: 's2', status: 'CONFIRMED', lines: [] });

      const result = await service.accept('c1', 'u1', { id: 's2', purchaseOrderItemId: 'item1', status: 'PROPOSED' }, 's1');

      expect(prisma.tenant.purchaseOrderItem.updateMany).toHaveBeenCalledWith({
        where: { id: 'item1', currentDeliveryScheduleId: 's1' },
        data: { currentDeliveryScheduleId: 's2' },
      });
      expect(prisma.tenant.deliverySchedule.update).toHaveBeenNthCalledWith(1, { where: { id: 's1' }, data: { status: 'SUPERSEDED' } });
      expect(prisma.tenant.deliverySchedule.update).toHaveBeenNthCalledWith(2, {
        where: { id: 's2' },
        data: { status: 'CONFIRMED', respondedById: 'u1', respondedAt: expect.any(Date) },
        include: { lines: true },
      });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'purchase_order.schedule_accepted' }));
      expect(result.status).toBe('CONFIRMED');
    });
  });

  describe('reject — the current version is never touched', () => {
    it('rejects a schedule that is not PROPOSED', async () => {
      await expect(service.reject('c1', 'u1', { id: 's2', purchaseOrderItemId: 'item1', status: 'CONFIRMED' })).rejects.toThrow(NotFoundException);
    });

    it('flips PROPOSED to REJECTED and never touches purchaseOrderItem.currentDeliveryScheduleId', async () => {
      prisma.tenant.deliverySchedule.update.mockResolvedValue({ id: 's2', status: 'REJECTED', lines: [] });

      const result = await service.reject('c1', 'u1', { id: 's2', purchaseOrderItemId: 'item1', status: 'PROPOSED' });

      expect(prisma.tenant.deliverySchedule.update).toHaveBeenCalledWith({
        where: { id: 's2' },
        data: { status: 'REJECTED', respondedById: 'u1', respondedAt: expect.any(Date) },
        include: { lines: true },
      });
      expect(prisma.tenant.purchaseOrderItem.updateMany).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'purchase_order.schedule_rejected' }));
      expect(result.status).toBe('REJECTED');
    });
  });
});
