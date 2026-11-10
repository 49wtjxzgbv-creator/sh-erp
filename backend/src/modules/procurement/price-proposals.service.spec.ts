import { PriceProposalsService } from './price-proposals.service';

describe('PriceProposalsService (2026-11-10 — "правка ціни щоб було тільки через підтвердження в основній erp")', () => {
  let service: PriceProposalsService;
  let prisma: any;
  let audit: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  beforeEach(() => {
    prisma = {
      tenant: {
        sourcingPriceProposal: {
          findMany: jest.fn().mockResolvedValue([]),
          findUnique: jest.fn(),
          update: jest.fn(),
        },
        productSupplier: {
          upsert: jest.fn(),
        },
      },
    };
    audit = { record: jest.fn() };
    service = new PriceProposalsService(prisma, audit);
  });

  describe('query', () => {
    it('lists only PENDING proposals, mapping the Decimal price to a plain number', async () => {
      prisma.tenant.sourcingPriceProposal.findMany.mockResolvedValue([
        { id: 'prop1', product: { id: 'p1', article: 'A1', name: 'Деталь' }, supplier: { id: 's1', name: 'ARGIP' }, proposedPriceEur: 14.5, note: null, proposedByUserId: 'u2', createdAt: new Date() },
      ]);

      const result = await service.query(user as any);

      expect(prisma.tenant.sourcingPriceProposal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'PENDING' } }),
      );
      expect(result[0].proposedPriceEur).toBe(14.5);
    });
  });

  describe('approve', () => {
    it('rejects an unknown proposal', async () => {
      prisma.tenant.sourcingPriceProposal.findUnique.mockResolvedValue(null);
      await expect(service.approve(user as any, 'missing')).rejects.toMatchObject({ response: { code: 'PRICE_PROPOSAL_NOT_FOUND' } });
    });

    it('rejects a proposal that is no longer PENDING, without touching ProductSupplier', async () => {
      prisma.tenant.sourcingPriceProposal.findUnique.mockResolvedValue({ id: 'prop1', status: 'APPROVED' });
      await expect(service.approve(user as any, 'prop1')).rejects.toMatchObject({ response: { code: 'PRICE_PROPOSAL_NOT_PENDING' } });
      expect(prisma.tenant.productSupplier.upsert).not.toHaveBeenCalled();
    });

    it('upserts ProductSupplier.price by (productId, supplierId) and marks the proposal APPROVED', async () => {
      prisma.tenant.sourcingPriceProposal.findUnique.mockResolvedValue({ id: 'prop1', status: 'PENDING', productId: 'p1', supplierId: 's1', proposedPriceEur: 14.5 });
      prisma.tenant.sourcingPriceProposal.update.mockResolvedValue({ id: 'prop1', status: 'APPROVED' });

      await service.approve(user as any, 'prop1');

      expect(prisma.tenant.productSupplier.upsert).toHaveBeenCalledWith({
        where: { productId_supplierId: { productId: 'p1', supplierId: 's1' } },
        create: expect.objectContaining({ productId: 'p1', supplierId: 's1', price: 14.5 }),
        update: { price: 14.5 },
      });
      expect(prisma.tenant.sourcingPriceProposal.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'prop1' }, data: expect.objectContaining({ status: 'APPROVED', reviewedByUserId: 'u1' }) }),
      );
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'sourcing_price_proposal.approved' }));
    });
  });

  describe('reject', () => {
    it('marks the proposal REJECTED without touching ProductSupplier at all', async () => {
      prisma.tenant.sourcingPriceProposal.findUnique.mockResolvedValue({ id: 'prop1', status: 'PENDING', productId: 'p1', supplierId: 's1', proposedPriceEur: 14.5 });
      prisma.tenant.sourcingPriceProposal.update.mockResolvedValue({ id: 'prop1', status: 'REJECTED' });

      await service.reject(user as any, 'prop1');

      expect(prisma.tenant.productSupplier.upsert).not.toHaveBeenCalled();
      expect(prisma.tenant.sourcingPriceProposal.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'prop1' }, data: expect.objectContaining({ status: 'REJECTED', reviewedByUserId: 'u1' }) }),
      );
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'sourcing_price_proposal.rejected' }));
    });

    it('rejects a proposal that is no longer PENDING', async () => {
      prisma.tenant.sourcingPriceProposal.findUnique.mockResolvedValue({ id: 'prop1', status: 'REJECTED' });
      await expect(service.reject(user as any, 'prop1')).rejects.toMatchObject({ response: { code: 'PRICE_PROPOSAL_NOT_PENDING' } });
    });
  });
});
