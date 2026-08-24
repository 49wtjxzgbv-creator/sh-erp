import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FinanceService } from './finance.service';

/**
 * Finance module (2026-08-24). Covers the design's explicit test list:
 * document creation, multiple payments on one document (unpaid -> partial ->
 * paid), an expense with and without a linked document, a document with no
 * amount (rejects payments), multiple currencies (bucketed separately, never
 * blended), the ownership-chain 404 pattern that stands in for cross-tenant
 * isolation at the unit-test layer (real RLS is DB-level, not exercised by a
 * mocked-Prisma test — see the accompanying implementation report), and —
 * the most important one — that a goods invoice Document never inflates
 * `additionalExpenses`/`actualCost` (the double-counting guard the whole
 * money model exists to prevent).
 *
 * Unlike DeliverySchedulesService, FinanceService has NO nested Prisma
 * creates at all (every create is a top-level call with scalar FK columns —
 * `companyId`/`purchaseOrderId`/`documentId` passed directly in `data`, not
 * via a nested `relation: { create: ... } }`), so there is no
 * "tenantScopingExtension doesn't stamp nested creates" bug class to
 * regress-test here the way delivery-schedules.service.spec.ts does. What IS
 * pinned instead: every top-level create call's exact `data` shape,
 * including the explicit `companyId`/`createdById` stamps — see the
 * "explicit companyId on top-level creates" tests below.
 */
describe('FinanceService', () => {
  let service: FinanceService;
  let prisma: any;
  let audit: any;

  const order = (overrides: Partial<any> = {}) => ({
    id: 'po1',
    items: [{ qtyOrdered: 10, expectedPrice: 400, actualPrice: null }],
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      tenant: {
        purchaseOrder: { findUnique: jest.fn(), findMany: jest.fn() },
        purchaseOrderDocument: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
        purchaseOrderPayment: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
        purchaseOrderExpense: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
        supplier: { findUnique: jest.fn() },
        customerOrder: { findUnique: jest.fn(), findMany: jest.fn() },
        customerOrderDocument: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
        customerOrderPayment: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
        customerOrderExpense: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
      },
    };
    audit = { record: jest.fn() };
    service = new FinanceService(prisma, audit);
  });

  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.c', roleId: 'r1' };

  // ---------------------------------------------------------------------
  // Documents
  // ---------------------------------------------------------------------

  describe('createDocument', () => {
    it('creates a document with an explicit companyId/createdById stamp on the top-level create', async () => {
      prisma.tenant.purchaseOrder.findUnique.mockResolvedValue(order());
      prisma.tenant.supplier.findUnique.mockResolvedValue({ id: 's1', name: 'ABC Ltd' });
      prisma.tenant.purchaseOrderDocument.create.mockResolvedValue({ id: 'doc1', amount: 4000, currency: 'EUR' });

      await service.createDocument(user, 'po1', {
        documentType: 'INVOICE',
        counterpartyId: 's1',
        amount: 4000,
      } as any);

      expect(prisma.tenant.purchaseOrderDocument.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyId: 'c1',
          purchaseOrderId: 'po1',
          counterpartyId: 's1',
          amount: 4000,
          currency: 'EUR',
          createdById: 'u1',
        }),
      });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'finance_document.created', entityId: 'doc1' }));
    });

    it('404s when the purchase order does not exist (ownership-chain check, stands in for cross-tenant isolation at this layer — see file header comment)', async () => {
      prisma.tenant.purchaseOrder.findUnique.mockResolvedValue(null);
      await expect(service.createDocument(user, 'po-other-tenant', { documentType: 'INVOICE', counterpartyId: 's1' } as any)).rejects.toThrow(NotFoundException);
      expect(prisma.tenant.purchaseOrderDocument.create).not.toHaveBeenCalled();
    });

    it('404s when the counterparty supplier does not exist', async () => {
      prisma.tenant.purchaseOrder.findUnique.mockResolvedValue(order());
      prisma.tenant.supplier.findUnique.mockResolvedValue(null);
      await expect(service.createDocument(user, 'po1', { documentType: 'INVOICE', counterpartyId: 'ghost' } as any)).rejects.toThrow(NotFoundException);
      expect(prisma.tenant.purchaseOrderDocument.create).not.toHaveBeenCalled();
    });

    it('allows omitting amount for a document with no monetary value (e.g. a Packing List)', async () => {
      prisma.tenant.purchaseOrder.findUnique.mockResolvedValue(order());
      prisma.tenant.supplier.findUnique.mockResolvedValue({ id: 's1' });
      prisma.tenant.purchaseOrderDocument.create.mockResolvedValue({ id: 'doc2', amount: null });

      await service.createDocument(user, 'po1', { documentType: 'PACKING_LIST', counterpartyId: 's1' } as any);
      expect(prisma.tenant.purchaseOrderDocument.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ amount: undefined, currency: 'EUR' }),
      });
    });
  });

  describe('updateDocument', () => {
    it('rejects clearing the amount once payments exist', async () => {
      prisma.tenant.purchaseOrderDocument.findUnique.mockResolvedValue({ id: 'doc1', amount: 100, currency: 'EUR', payments: [{ amount: 50, currency: 'EUR' }] });
      await expect(service.updateDocument(user, 'doc1', { amount: null } as any)).rejects.toThrow(BadRequestException);
      expect(prisma.tenant.purchaseOrderDocument.update).not.toHaveBeenCalled();
    });

    it('allows clearing the amount when there are no payments', async () => {
      prisma.tenant.purchaseOrderDocument.findUnique.mockResolvedValue({ id: 'doc1', amount: 100, currency: 'EUR', payments: [] });
      prisma.tenant.purchaseOrderDocument.update.mockResolvedValue({ id: 'doc1', amount: null });
      await service.updateDocument(user, 'doc1', { amount: null } as any);
      expect(prisma.tenant.purchaseOrderDocument.update).toHaveBeenCalledWith({ where: { id: 'doc1' }, data: { amount: null } });
    });
  });

  describe('deleteDocument', () => {
    it('deletes and records an audit event with the prior state', async () => {
      prisma.tenant.purchaseOrderDocument.findUnique.mockResolvedValue({ id: 'doc1', amount: 100, currency: 'EUR', payments: [] });
      prisma.tenant.purchaseOrderDocument.delete.mockResolvedValue({});
      await service.deleteDocument(user, 'doc1');
      expect(prisma.tenant.purchaseOrderDocument.delete).toHaveBeenCalledWith({ where: { id: 'doc1' } });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'finance_document.deleted', entityId: 'doc1' }));
    });
  });

  // ---------------------------------------------------------------------
  // Payments — point 8/9 of the confirmed design
  // ---------------------------------------------------------------------

  describe('addPayment', () => {
    it('rejects a payment on a document with no amount', async () => {
      prisma.tenant.purchaseOrderDocument.findUnique.mockResolvedValue({ id: 'doc1', amount: null, currency: 'EUR', payments: [] });
      await expect(service.addPayment(user, 'doc1', { amount: 100, paidAt: new Date() } as any)).rejects.toThrow(BadRequestException);
      expect(prisma.tenant.purchaseOrderPayment.create).not.toHaveBeenCalled();
    });

    it('rejects a payment exceeding the remaining balance (same currency)', async () => {
      prisma.tenant.purchaseOrderDocument.findUnique.mockResolvedValue({
        id: 'doc1', amount: 5000, currency: 'EUR', payments: [{ amount: 3000, currency: 'EUR' }],
      });
      await expect(service.addPayment(user, 'doc1', { amount: 2500, paidAt: new Date() } as any)).rejects.toThrow(BadRequestException);
      expect(prisma.tenant.purchaseOrderPayment.create).not.toHaveBeenCalled();
    });

    it('allows a payment that exactly exhausts the remaining balance, moving the document to fully paid', async () => {
      prisma.tenant.purchaseOrderDocument.findUnique.mockResolvedValue({
        id: 'doc1', amount: 5000, currency: 'EUR', payments: [{ amount: 3000, currency: 'EUR' }],
      });
      prisma.tenant.purchaseOrderPayment.create.mockResolvedValue({ id: 'pay2', amount: 2000, currency: 'EUR' });

      const result = await service.addPayment(user, 'doc1', { amount: 2000, paidAt: new Date() } as any);
      expect(prisma.tenant.purchaseOrderPayment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ companyId: 'c1', documentId: 'doc1', amount: 2000, currency: 'EUR', createdById: 'u1' }),
      });
      expect(result.currencyMismatch).toBe(false);
    });

    it('records a mismatched-currency payment without applying the overpayment check, and flags it', async () => {
      prisma.tenant.purchaseOrderDocument.findUnique.mockResolvedValue({
        id: 'doc1', amount: 100, currency: 'EUR', payments: [{ amount: 100, currency: 'EUR' }], // already fully paid in EUR
      });
      prisma.tenant.purchaseOrderPayment.create.mockResolvedValue({ id: 'pay-usd', amount: 50, currency: 'USD' });

      const result = await service.addPayment(user, 'doc1', { amount: 50, currency: 'USD', paidAt: new Date() } as any);
      expect(prisma.tenant.purchaseOrderPayment.create).toHaveBeenCalled(); // not blocked despite EUR side already being "full"
      expect(result.currencyMismatch).toBe(true);
    });

    it('splits one invoice into two payments: unpaid -> partial -> paid', async () => {
      // Payment 1 of 2: €5000 invoice, no payments yet.
      prisma.tenant.purchaseOrderDocument.findUnique.mockResolvedValueOnce({ id: 'doc1', amount: 5000, currency: 'EUR', payments: [] });
      prisma.tenant.purchaseOrderPayment.create.mockResolvedValueOnce({ id: 'pay1', amount: 2000, currency: 'EUR' });
      await service.addPayment(user, 'doc1', { amount: 2000, paidAt: new Date() } as any);

      // Payment 2 of 2: now €2000 already paid.
      prisma.tenant.purchaseOrderDocument.findUnique.mockResolvedValueOnce({ id: 'doc1', amount: 5000, currency: 'EUR', payments: [{ amount: 2000, currency: 'EUR' }] });
      prisma.tenant.purchaseOrderPayment.create.mockResolvedValueOnce({ id: 'pay2', amount: 3000, currency: 'EUR' });
      await service.addPayment(user, 'doc1', { amount: 3000, paidAt: new Date() } as any);

      expect(prisma.tenant.purchaseOrderPayment.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('getDocument — derived payment status', () => {
    const withPayments = (amount: number | null, payments: { amount: number; currency: string }[]) => {
      prisma.tenant.purchaseOrderDocument.findUnique.mockResolvedValue({ id: 'doc1', amount, currency: 'EUR', payments });
    };

    it('is NO_AMOUNT when the document has no amount', async () => {
      withPayments(null, []);
      expect((await service.getDocument(user, 'doc1')).paymentStatus).toBe('NO_AMOUNT');
    });

    it('is UNPAID with zero payments', async () => {
      withPayments(5000, []);
      expect((await service.getDocument(user, 'doc1')).paymentStatus).toBe('UNPAID');
    });

    it('is PARTIAL between zero and the full amount', async () => {
      withPayments(5000, [{ amount: 3000, currency: 'EUR' }]);
      expect((await service.getDocument(user, 'doc1')).paymentStatus).toBe('PARTIAL');
    });

    it('is PAID once payments reach the full amount', async () => {
      withPayments(5000, [{ amount: 2000, currency: 'EUR' }, { amount: 3000, currency: 'EUR' }]);
      expect((await service.getDocument(user, 'doc1')).paymentStatus).toBe('PAID');
    });

    it('ignores a mismatched-currency payment when deriving status (does not count toward EUR paid)', async () => {
      withPayments(5000, [{ amount: 5000, currency: 'USD' }]);
      expect((await service.getDocument(user, 'doc1')).paymentStatus).toBe('UNPAID');
    });
  });

  // ---------------------------------------------------------------------
  // Expenses — with/without a linked document, and the double-counting guard
  // ---------------------------------------------------------------------

  describe('createExpense', () => {
    it('creates an expense with no linked document (cost known before any invoice arrives)', async () => {
      prisma.tenant.purchaseOrder.findUnique.mockResolvedValue(order());
      prisma.tenant.purchaseOrderExpense.create.mockResolvedValue({ id: 'exp1' });

      await service.createExpense(user, 'po1', { category: 'INSURANCE', amount: 40 } as any);
      expect(prisma.tenant.purchaseOrderExpense.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ companyId: 'c1', purchaseOrderId: 'po1', category: 'INSURANCE', amount: 40, documentId: undefined }),
      });
    });

    it('creates an expense linked to its confirming document, after verifying the document belongs to the same PO', async () => {
      prisma.tenant.purchaseOrder.findUnique.mockResolvedValue(order());
      prisma.tenant.purchaseOrderDocument.findUnique.mockResolvedValue({ id: 'doc-dhl', purchaseOrderId: 'po1' });
      prisma.tenant.purchaseOrderExpense.create.mockResolvedValue({ id: 'exp2' });

      await service.createExpense(user, 'po1', { category: 'SHIPPING', amount: 180, documentId: 'doc-dhl' } as any);
      expect(prisma.tenant.purchaseOrderExpense.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ documentId: 'doc-dhl' }),
      });
    });

    it('404s when the linked document belongs to a different purchase order', async () => {
      prisma.tenant.purchaseOrder.findUnique.mockResolvedValue(order());
      prisma.tenant.purchaseOrderDocument.findUnique.mockResolvedValue({ id: 'doc-other', purchaseOrderId: 'po-OTHER' });
      await expect(service.createExpense(user, 'po1', { category: 'SHIPPING', amount: 180, documentId: 'doc-other' } as any)).rejects.toThrow(NotFoundException);
      expect(prisma.tenant.purchaseOrderExpense.create).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------
  // Summary — the six metrics, exactly the scenarios validated with the user
  // ---------------------------------------------------------------------

  describe('getSummary', () => {
    const setup = (items: any[], documents: any[], expenses: any[], payments: any[]) => {
      prisma.tenant.purchaseOrder.findUnique.mockResolvedValue({ id: 'po1', items });
      prisma.tenant.purchaseOrderDocument.findMany.mockResolvedValue(documents);
      prisma.tenant.purchaseOrderExpense.findMany.mockResolvedValue(expenses);
      prisma.tenant.purchaseOrderPayment.findMany.mockResolvedValue(payments);
    };
    const d = (over: Partial<any>) => ({ createdAt: new Date(), currency: 'EUR', ...over });

    it('Scenario A — everything documented: goods 4000 + expenses 250 = actual 4250; unpaidPerDocuments = 1250', async () => {
      setup(
        [{ qtyOrdered: 1, expectedPrice: 4000, actualPrice: null }],
        [d({ amount: 4000 }), d({ amount: 180 }), d({ amount: 70 })],
        [d({ amount: 180 }), d({ amount: 70 })],
        [d({ amount: 3000 })],
      );
      const s = await service.getSummary(user, 'po1');
      expect(s.goodsCost).toBe(4000);
      expect(s.additionalExpenses).toBe(250);
      expect(s.actualCost).toBe(4250);
      expect(s.totalDocuments).toBe(4250);
      expect(s.paid).toBe(3000);
      expect(s.unpaidPerDocuments).toBe(1250);
    });

    it('Scenario B — an expense with no confirming document yet: actualCost (4290) diverges from totalDocuments (4250)', async () => {
      setup(
        [{ qtyOrdered: 1, expectedPrice: 4000, actualPrice: null }],
        [d({ amount: 4000 }), d({ amount: 180 }), d({ amount: 70 })], // no document for the €40 insurance yet
        [d({ amount: 180 }), d({ amount: 70 }), d({ amount: 40 })],
        [d({ amount: 3000 })],
      );
      const s = await service.getSummary(user, 'po1');
      expect(s.actualCost).toBe(4290);
      expect(s.totalDocuments).toBe(4250); // the undocumented €40 does NOT appear here
      expect(s.unpaidPerDocuments).toBe(1250); // NOT 1290 — never derived from actualCost
    });

    it('Scenario C — goods invoice Document never becomes an Expense (no double counting)', async () => {
      setup(
        [{ qtyOrdered: 1, expectedPrice: 4000, actualPrice: null }],
        [d({ amount: 4000 })], // ABC Ltd goods invoice, fully paid
        [], // deliberately NO expense row for the goods
        [d({ amount: 4000 })],
      );
      const s = await service.getSummary(user, 'po1');
      expect(s.additionalExpenses).toBe(0);
      expect(s.actualCost).toBe(4000); // NOT 8000
      expect(s.unpaidPerDocuments).toBe(0);
    });

    it('Scenario D — a document with no amount (Packing List) counts toward documentCount but not totalDocuments', async () => {
      setup(
        [{ qtyOrdered: 1, expectedPrice: 4000, actualPrice: null }],
        [d({ amount: 4000 }), d({ amount: 180 }), d({ amount: 70 }), d({ amount: null })],
        [d({ amount: 180 }), d({ amount: 70 })],
        [d({ amount: 3000 })],
      );
      const s = await service.getSummary(user, 'po1');
      expect(s.documentCount).toBe(4);
      expect(s.totalDocuments).toBe(4250); // the amount-less document excluded from the sum
    });

    it('uses actualPrice over expectedPrice when both are present (realized cost wins)', async () => {
      setup([{ qtyOrdered: 2, expectedPrice: 100, actualPrice: 90 }], [], [], []);
      const s = await service.getSummary(user, 'po1');
      expect(s.goodsCost).toBe(180);
    });

    it('buckets a different currency separately instead of blending it into the primary EUR sum', async () => {
      setup(
        [{ qtyOrdered: 1, expectedPrice: 1000, actualPrice: null }],
        [d({ amount: 1000 }), d({ amount: 200, currency: 'USD' })],
        [],
        [d({ amount: 1000 }), d({ amount: 200, currency: 'USD' })],
      );
      const s = await service.getSummary(user, 'po1');
      expect(s.totalDocuments).toBe(1000); // USD document excluded
      expect(s.paid).toBe(1000);
      expect(s.otherCurrencies).toEqual([
        expect.objectContaining({ currency: 'USD', totalDocuments: 200, paid: 200, unpaidPerDocuments: 0 }),
      ]);
    });

    // Pre-production audit (2026-08-24), point 4: "система НІКОЛИ мовчки не
    // додає EUR + USD" — verified for all three money entities together,
    // not just Document+Payment. An EUR Expense and a USD Expense on the
    // same PO must never be summed into one number.
    it('never mixes EUR and USD for Expenses either — a USD expense stays out of the primary (EUR) additionalExpenses/actualCost', async () => {
      setup(
        [{ qtyOrdered: 1, expectedPrice: 4000, actualPrice: null }],
        [],
        [d({ amount: 180 }), d({ amount: 500, currency: 'USD' })], // €180 shipping + $500 customs-in-USD expense
        [],
      );
      const s = await service.getSummary(user, 'po1');
      expect(s.additionalExpenses).toBe(180); // USD expense excluded from the EUR figure
      expect(s.actualCost).toBe(4180); // NOT 4000 + 180 + 500
      expect(s.otherCurrencies).toEqual([
        expect.objectContaining({ currency: 'USD', additionalExpenses: 500, totalDocuments: 0, paid: 0, unpaidPerDocuments: 0 }),
      ]);
    });
  });

  // -----------------------------------------------------------------------
  // Pre-production audit (2026-08-24), point 3 — the exact scenario given:
  // €100 doc -> €40 partial -> +€60 paid -> +€1 over -> 400 -> €0 -> 400 ->
  // negative -> 400 -> mismatched currency -> defined (recorded, flagged,
  // no overpay check) -> delete a payment -> status recomputes live.
  // -----------------------------------------------------------------------
  describe('audit scenario — €100 document, full payment lifecycle', () => {
    it('walks unpaid -> partial (€40) -> paid (+€60), rejects +€1 over, and recomputes after a payment is deleted', async () => {
      // 1. Document has no payments yet.
      prisma.tenant.purchaseOrderDocument.findUnique.mockResolvedValueOnce({ id: 'doc1', amount: 100, currency: 'EUR', payments: [] });
      expect((await service.getDocument(user, 'doc1')).paymentStatus).toBe('UNPAID');

      // 2. €40 payment -> PARTIAL.
      prisma.tenant.purchaseOrderDocument.findUnique.mockResolvedValueOnce({ id: 'doc1', amount: 100, currency: 'EUR', payments: [] });
      prisma.tenant.purchaseOrderPayment.create.mockResolvedValueOnce({ id: 'pay1', amount: 40, currency: 'EUR' });
      await service.addPayment(user, 'doc1', { amount: 40, paidAt: new Date('2026-08-20') } as any);

      prisma.tenant.purchaseOrderDocument.findUnique.mockResolvedValueOnce({ id: 'doc1', amount: 100, currency: 'EUR', payments: [{ amount: 40, currency: 'EUR' }] });
      expect((await service.getDocument(user, 'doc1')).paymentStatus).toBe('PARTIAL');

      // 3. +€60 payment -> PAID (exactly exhausts the remaining €60).
      prisma.tenant.purchaseOrderDocument.findUnique.mockResolvedValueOnce({ id: 'doc1', amount: 100, currency: 'EUR', payments: [{ amount: 40, currency: 'EUR' }] });
      prisma.tenant.purchaseOrderPayment.create.mockResolvedValueOnce({ id: 'pay2', amount: 60, currency: 'EUR' });
      await service.addPayment(user, 'doc1', { amount: 60, paidAt: new Date('2026-08-21') } as any);

      prisma.tenant.purchaseOrderDocument.findUnique.mockResolvedValueOnce({ id: 'doc1', amount: 100, currency: 'EUR', payments: [{ amount: 40, currency: 'EUR' }, { amount: 60, currency: 'EUR' }] });
      expect((await service.getDocument(user, 'doc1')).paymentStatus).toBe('PAID');

      // 4. A further +€1 attempt on a document already fully paid -> rejected, no third payment created.
      prisma.tenant.purchaseOrderDocument.findUnique.mockResolvedValueOnce({ id: 'doc1', amount: 100, currency: 'EUR', payments: [{ amount: 40, currency: 'EUR' }, { amount: 60, currency: 'EUR' }] });
      await expect(service.addPayment(user, 'doc1', { amount: 1, paidAt: new Date('2026-08-22') } as any)).rejects.toThrow(BadRequestException);
      expect(prisma.tenant.purchaseOrderPayment.create).toHaveBeenCalledTimes(2); // still only the 2 legitimate payments

      // 5. Delete the €60 payment -> status must recompute live back to PARTIAL, not stay cached as PAID.
      prisma.tenant.purchaseOrderPayment.findUnique.mockResolvedValueOnce({ id: 'pay2', amount: 60, currency: 'EUR', documentId: 'doc1' });
      await service.deletePayment(user, 'pay2');
      expect(prisma.tenant.purchaseOrderPayment.delete).toHaveBeenCalledWith({ where: { id: 'pay2' } });

      prisma.tenant.purchaseOrderDocument.findUnique.mockResolvedValueOnce({ id: 'doc1', amount: 100, currency: 'EUR', payments: [{ amount: 40, currency: 'EUR' }] });
      expect((await service.getDocument(user, 'doc1')).paymentStatus).toBe('PARTIAL');
    });

    // €0 and negative payment amounts never reach this service at all —
    // class-validator's @Min(0.01) on CreatePurchaseOrderPaymentDto (see
    // "rejects a zero amount"/"rejects a negative amount" in
    // dto/finance-dto.spec.ts) combined with the app's global ValidationPipe
    // (main.ts: whitelist + forbidNonWhitelisted) turns those into a real
    // HTTP 400 before any controller/service code runs — confirmed by
    // direct code read of main.ts's `useGlobalPipes` registration.
  });

  describe('updatePayment', () => {
    it('excludes the payment being edited from its own remaining-balance check (raising its amount up to the full document total is allowed)', async () => {
      prisma.tenant.purchaseOrderPayment.findUnique.mockResolvedValue({ id: 'pay1', documentId: 'doc1', amount: 2000, currency: 'EUR' });
      prisma.tenant.purchaseOrderDocument.findUnique.mockResolvedValue({
        id: 'doc1', amount: 5000, currency: 'EUR', payments: [{ id: 'pay1', amount: 2000, currency: 'EUR' }, { id: 'pay2', amount: 3000, currency: 'EUR' }],
      });
      prisma.tenant.purchaseOrderPayment.update.mockResolvedValue({ id: 'pay1', amount: 2000, currency: 'EUR' });

      const result = await service.updatePayment(user, 'pay1', { amount: 2000 } as any);
      expect(prisma.tenant.purchaseOrderPayment.update).toHaveBeenCalledWith({
        where: { id: 'pay1' },
        data: expect.objectContaining({ amount: 2000 }),
      });
      expect(result.currencyMismatch).toBe(false);
    });

    it('rejects raising the amount past the remaining balance (excluding itself)', async () => {
      prisma.tenant.purchaseOrderPayment.findUnique.mockResolvedValue({ id: 'pay1', documentId: 'doc1', amount: 2000, currency: 'EUR' });
      prisma.tenant.purchaseOrderDocument.findUnique.mockResolvedValue({
        id: 'doc1', amount: 5000, currency: 'EUR', payments: [{ id: 'pay1', amount: 2000, currency: 'EUR' }, { id: 'pay2', amount: 3000, currency: 'EUR' }],
      });

      await expect(service.updatePayment(user, 'pay1', { amount: 2001 } as any)).rejects.toThrow(BadRequestException);
      expect(prisma.tenant.purchaseOrderPayment.update).not.toHaveBeenCalled();
    });

    it('404s when the payment does not exist', async () => {
      prisma.tenant.purchaseOrderPayment.findUnique.mockResolvedValue(null);
      await expect(service.updatePayment(user, 'ghost', { amount: 10 } as any)).rejects.toThrow(NotFoundException);
    });
  });

  describe('listPurchaseOrdersWithSummary — derived PO-level payment status', () => {
    it('classifies UNPAID / PARTIAL / PAID from totalDocuments vs paid', async () => {
      prisma.tenant.purchaseOrder.findMany.mockResolvedValue([
        { id: 'po-unpaid', items: [], supplierNameSnapshot: 'S1', supplierId: 's1', status: 'ORDERED', orderDate: new Date() },
        { id: 'po-partial', items: [], supplierNameSnapshot: 'S2', supplierId: 's2', status: 'ORDERED', orderDate: new Date() },
        { id: 'po-paid', items: [], supplierNameSnapshot: 'S3', supplierId: 's3', status: 'ORDERED', orderDate: new Date() },
      ]);
      const d = (purchaseOrderId: string, amount: number) => ({ purchaseOrderId, amount, currency: 'EUR', createdAt: new Date() });
      prisma.tenant.purchaseOrderDocument.findMany.mockResolvedValue([d('po-unpaid', 100), d('po-partial', 100), d('po-paid', 100)]);
      prisma.tenant.purchaseOrderExpense.findMany.mockResolvedValue([]);
      prisma.tenant.purchaseOrderPayment.findMany.mockResolvedValue([
        { amount: 40, currency: 'EUR', createdAt: new Date(), document: { purchaseOrderId: 'po-partial' } },
        { amount: 100, currency: 'EUR', createdAt: new Date(), document: { purchaseOrderId: 'po-paid' } },
      ]);

      const result = await service.listPurchaseOrdersWithSummary(user, {} as any);
      const byId = Object.fromEntries(result.items.map((r: any) => [r.purchaseOrder.id, r.paymentStatus]));
      expect(byId['po-unpaid']).toBe('UNPAID');
      expect(byId['po-partial']).toBe('PARTIAL');
      expect(byId['po-paid']).toBe('PAID');
    });

    it('filters by paymentStatus after computing it in-memory', async () => {
      prisma.tenant.purchaseOrder.findMany.mockResolvedValue([
        { id: 'po-unpaid', items: [], supplierNameSnapshot: 'S1', supplierId: 's1', status: 'ORDERED', orderDate: new Date() },
        { id: 'po-paid', items: [], supplierNameSnapshot: 'S3', supplierId: 's3', status: 'ORDERED', orderDate: new Date() },
      ]);
      const d = (purchaseOrderId: string, amount: number) => ({ purchaseOrderId, amount, currency: 'EUR', createdAt: new Date() });
      prisma.tenant.purchaseOrderDocument.findMany.mockResolvedValue([d('po-unpaid', 100), d('po-paid', 100)]);
      prisma.tenant.purchaseOrderExpense.findMany.mockResolvedValue([]);
      prisma.tenant.purchaseOrderPayment.findMany.mockResolvedValue([
        { amount: 100, currency: 'EUR', createdAt: new Date(), document: { purchaseOrderId: 'po-paid' } },
      ]);

      const result = await service.listPurchaseOrdersWithSummary(user, { paymentStatus: 'PAID' } as any);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].purchaseOrder.id).toBe('po-paid');
      expect(result.total).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // CustomerOrder-Finance (2026-08-24) — cost rolled up from linked
  // PurchaseOrders (sourceCustomerOrderId) + direct documents/expenses on
  // the order itself. Same double-counting/currency discipline as the
  // PO-side tests above, one level up.
  // -----------------------------------------------------------------------
  describe('getCustomerOrderSummary', () => {
    const d = (over: Partial<any>) => ({ createdAt: new Date(), currency: 'EUR', ...over });

    it('rolls up two linked purchase orders + a direct expense, with no double counting', async () => {
      prisma.tenant.customerOrder.findUnique.mockResolvedValue({ id: 'co1' });
      prisma.tenant.purchaseOrder.findMany.mockResolvedValue([
        { id: 'poA', supplierNameSnapshot: 'S-A', status: 'ORDERED', orderDate: new Date(), items: [{ qtyOrdered: 1, expectedPrice: 4000, actualPrice: null }] },
        { id: 'poB', supplierNameSnapshot: 'S-B', status: 'ORDERED', orderDate: new Date(), items: [{ qtyOrdered: 1, expectedPrice: 800, actualPrice: null }] },
      ]);
      prisma.tenant.purchaseOrderDocument.findMany.mockResolvedValue([d({ purchaseOrderId: 'poA', amount: 4000 }), d({ purchaseOrderId: 'poB', amount: 800 })]);
      prisma.tenant.purchaseOrderExpense.findMany.mockResolvedValue([]);
      prisma.tenant.purchaseOrderPayment.findMany.mockResolvedValue([
        { ...d({ amount: 4000 }), document: { purchaseOrderId: 'poA' } },
      ]);
      prisma.tenant.customerOrderDocument.findMany.mockResolvedValue([]);
      prisma.tenant.customerOrderExpense.findMany.mockResolvedValue([d({ amount: 50 })]); // e.g. packaging, not tied to any PO
      prisma.tenant.customerOrderPayment.findMany.mockResolvedValue([]);

      const s = await service.getCustomerOrderSummary(user, 'co1');
      expect(s.purchaseCost).toBe(4800); // 4000 + 800, never re-entered as an expense
      expect(s.additionalExpenses).toBe(50); // ONLY the direct packaging expense — PO cost must not leak in here
      expect(s.actualCost).toBe(4850);
      expect(s.totalDocuments).toBe(4800); // 4000 + 800, no direct documents
      expect(s.paid).toBe(4000);
      expect(s.unpaidPerDocuments).toBe(800);
      expect(s.documentCount).toBe(2); // 1 per linked PO, 0 direct
      expect(s.purchaseOrders).toHaveLength(2);
      expect(s.purchaseOrders.find((p) => p.purchaseOrder.id === 'poA')!.summary.actualCost).toBe(4000);
    });

    it('an order with no linked purchase orders at all — a direct document with no linked Expense counts toward actualCost on its own (2026-08-24: "не завжди робитиму все через закупівлі")', async () => {
      prisma.tenant.customerOrder.findUnique.mockResolvedValue({ id: 'co1' });
      prisma.tenant.purchaseOrder.findMany.mockResolvedValue([]);
      prisma.tenant.customerOrderDocument.findMany.mockResolvedValue([d({ id: 'doc1', amount: 200 })]);
      prisma.tenant.customerOrderExpense.findMany.mockResolvedValue([]);
      prisma.tenant.customerOrderPayment.findMany.mockResolvedValue([]);

      const s = await service.getCustomerOrderSummary(user, 'co1');
      expect(s.purchaseCost).toBe(0);
      expect(s.additionalExpenses).toBe(200); // unlike the PurchaseOrder side, a direct document has no items-based goods cost to double-count against
      expect(s.actualCost).toBe(200);
      expect(s.totalDocuments).toBe(200);
      expect(s.purchaseOrders).toEqual([]);
    });

    it('a direct document already cited by an Expense (documentId) is NOT counted twice — the Expense amount wins even when it differs from the document amount', async () => {
      prisma.tenant.customerOrder.findUnique.mockResolvedValue({ id: 'co1' });
      prisma.tenant.purchaseOrder.findMany.mockResolvedValue([]);
      prisma.tenant.customerOrderDocument.findMany.mockResolvedValue([d({ id: 'doc1', amount: 500 })]); // full invoice
      prisma.tenant.customerOrderExpense.findMany.mockResolvedValue([d({ amount: 300, documentId: 'doc1' })]); // only part of it is a real cost so far
      prisma.tenant.customerOrderPayment.findMany.mockResolvedValue([]);

      const s = await service.getCustomerOrderSummary(user, 'co1');
      expect(s.additionalExpenses).toBe(300); // the linked Expense's own amount, not the document's 500
      expect(s.actualCost).toBe(300);
      expect(s.totalDocuments).toBe(500); // the document's full amount still shows here, unaffected
    });

    it('a second, unlinked direct document on the same order still counts on its own alongside a linked one', async () => {
      prisma.tenant.customerOrder.findUnique.mockResolvedValue({ id: 'co1' });
      prisma.tenant.purchaseOrder.findMany.mockResolvedValue([]);
      prisma.tenant.customerOrderDocument.findMany.mockResolvedValue([
        d({ id: 'doc1', amount: 500 }), // linked to an Expense below
        d({ id: 'doc2', amount: 80 }), // no Expense at all
      ]);
      prisma.tenant.customerOrderExpense.findMany.mockResolvedValue([d({ amount: 300, documentId: 'doc1' })]);
      prisma.tenant.customerOrderPayment.findMany.mockResolvedValue([]);

      const s = await service.getCustomerOrderSummary(user, 'co1');
      expect(s.additionalExpenses).toBe(380); // 300 (linked Expense) + 80 (doc2's own amount, unlinked)
      expect(s.totalDocuments).toBe(580);
    });

    it('never mixes EUR and USD across the rollup + direct sources — merges same-currency buckets, keeps EUR/USD separate', async () => {
      prisma.tenant.customerOrder.findUnique.mockResolvedValue({ id: 'co1' });
      prisma.tenant.purchaseOrder.findMany.mockResolvedValue([
        { id: 'poA', supplierNameSnapshot: 'S-A', status: 'ORDERED', orderDate: new Date(), items: [] },
      ]);
      prisma.tenant.purchaseOrderDocument.findMany.mockResolvedValue([d({ purchaseOrderId: 'poA', amount: 300, currency: 'USD' })]);
      prisma.tenant.purchaseOrderExpense.findMany.mockResolvedValue([]);
      prisma.tenant.purchaseOrderPayment.findMany.mockResolvedValue([]);
      prisma.tenant.customerOrderDocument.findMany.mockResolvedValue([]);
      prisma.tenant.customerOrderExpense.findMany.mockResolvedValue([d({ amount: 20, currency: 'USD' })]);
      prisma.tenant.customerOrderPayment.findMany.mockResolvedValue([]);

      const s = await service.getCustomerOrderSummary(user, 'co1');
      expect(s.totalDocuments).toBe(0); // USD document excluded from the primary EUR figure
      expect(s.additionalExpenses).toBe(0); // USD expense excluded too
      expect(s.otherCurrencies).toEqual([
        expect.objectContaining({ currency: 'USD', totalDocuments: 300, additionalExpenses: 20, paid: 0 }),
      ]);
    });

    it('404s for a customer order that does not exist (or belongs to another tenant)', async () => {
      prisma.tenant.customerOrder.findUnique.mockResolvedValue(null);
      await expect(service.getCustomerOrderSummary(user, 'ghost')).rejects.toThrow(NotFoundException);
    });
  });

  describe('CustomerOrderDocument payments', () => {
    it('walks unpaid -> partial -> paid via addCustomerOrderPayment, same rules as the PO side', async () => {
      prisma.tenant.customerOrderDocument.findUnique.mockResolvedValueOnce({ id: 'cod1', amount: 100, currency: 'EUR', payments: [] });
      prisma.tenant.customerOrderPayment.create.mockResolvedValueOnce({ id: 'p1', amount: 60, currency: 'EUR' });
      const result = await service.addCustomerOrderPayment(user, 'cod1', { amount: 60, paidAt: new Date() } as any);
      expect(prisma.tenant.customerOrderPayment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ companyId: 'c1', documentId: 'cod1', amount: 60, currency: 'EUR', createdById: 'u1' }),
      });
      expect(result.currencyMismatch).toBe(false);
    });

    it('rejects a payment exceeding the remaining balance', async () => {
      prisma.tenant.customerOrderDocument.findUnique.mockResolvedValue({ id: 'cod1', amount: 100, currency: 'EUR', payments: [{ amount: 60, currency: 'EUR' }] });
      await expect(service.addCustomerOrderPayment(user, 'cod1', { amount: 50, paidAt: new Date() } as any)).rejects.toThrow(BadRequestException);
    });

    it('rejects a payment on a document with no amount', async () => {
      prisma.tenant.customerOrderDocument.findUnique.mockResolvedValue({ id: 'cod1', amount: null, currency: 'EUR', payments: [] });
      await expect(service.addCustomerOrderPayment(user, 'cod1', { amount: 10, paidAt: new Date() } as any)).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateCustomerOrderPayment', () => {
    it('excludes the payment being edited from its own remaining-balance check', async () => {
      prisma.tenant.customerOrderPayment.findUnique.mockResolvedValue({ id: 'p1', documentId: 'cod1', amount: 60, currency: 'EUR' });
      prisma.tenant.customerOrderDocument.findUnique.mockResolvedValue({
        id: 'cod1', amount: 100, currency: 'EUR', payments: [{ id: 'p1', amount: 60, currency: 'EUR' }],
      });
      prisma.tenant.customerOrderPayment.update.mockResolvedValue({ id: 'p1', amount: 100, currency: 'EUR' });

      const result = await service.updateCustomerOrderPayment(user, 'p1', { amount: 100 } as any);
      expect(prisma.tenant.customerOrderPayment.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: expect.objectContaining({ amount: 100 }),
      });
      expect(result.currencyMismatch).toBe(false);
    });

    it('rejects raising the amount past the remaining balance (excluding itself)', async () => {
      prisma.tenant.customerOrderPayment.findUnique.mockResolvedValue({ id: 'p1', documentId: 'cod1', amount: 60, currency: 'EUR' });
      prisma.tenant.customerOrderDocument.findUnique.mockResolvedValue({
        id: 'cod1', amount: 100, currency: 'EUR', payments: [{ id: 'p1', amount: 60, currency: 'EUR' }],
      });

      await expect(service.updateCustomerOrderPayment(user, 'p1', { amount: 101 } as any)).rejects.toThrow(BadRequestException);
      expect(prisma.tenant.customerOrderPayment.update).not.toHaveBeenCalled();
    });

    it('404s when the payment does not exist', async () => {
      prisma.tenant.customerOrderPayment.findUnique.mockResolvedValue(null);
      await expect(service.updateCustomerOrderPayment(user, 'ghost', { amount: 10 } as any)).rejects.toThrow(NotFoundException);
    });
  });

  describe('createCustomerOrderExpense — ownership chain', () => {
    it('404s when the linked document belongs to a different customer order', async () => {
      prisma.tenant.customerOrder.findUnique.mockResolvedValue({ id: 'co1' });
      prisma.tenant.customerOrderDocument.findUnique.mockResolvedValue({ id: 'doc-other', customerOrderId: 'co-OTHER' });
      await expect(
        service.createCustomerOrderExpense(user, 'co1', { category: 'OTHER', amount: 10, documentId: 'doc-other' } as any),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.tenant.customerOrderExpense.create).not.toHaveBeenCalled();
    });
  });
});
