import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePurchaseOrderDocumentDto } from './finance-document.dto';
import { CreatePurchaseOrderPaymentDto } from './finance-payment.dto';
import { CreatePurchaseOrderExpenseDto } from './finance-expense.dto';

/**
 * Point 9 of the confirmed design: amount/qty/dates/currency must be
 * validated on the BACKEND, not only in the frontend form. These pin the
 * class-validator decorators actually reject bad input, independent of
 * whatever the frontend does or doesn't check.
 */
describe('Finance DTO validation', () => {
  async function errorsFor<T extends object>(cls: new () => T, plain: Record<string, unknown>) {
    const instance = plainToInstance(cls, plain);
    return validate(instance as object);
  }

  describe('CreatePurchaseOrderPaymentDto', () => {
    it('rejects a zero amount', async () => {
      const errors = await errorsFor(CreatePurchaseOrderPaymentDto, { amount: 0, paidAt: '2026-08-20' });
      expect(errors.some((e) => e.property === 'amount')).toBe(true);
    });

    it('rejects a negative amount', async () => {
      const errors = await errorsFor(CreatePurchaseOrderPaymentDto, { amount: -50, paidAt: '2026-08-20' });
      expect(errors.some((e) => e.property === 'amount')).toBe(true);
    });

    it('rejects a missing paidAt', async () => {
      const errors = await errorsFor(CreatePurchaseOrderPaymentDto, { amount: 100 });
      expect(errors.some((e) => e.property === 'paidAt')).toBe(true);
    });

    it('rejects a lowercase/malformed currency', async () => {
      const errors = await errorsFor(CreatePurchaseOrderPaymentDto, { amount: 100, paidAt: '2026-08-20', currency: 'eur' });
      expect(errors.some((e) => e.property === 'currency')).toBe(true);
    });

    it('accepts a valid payload', async () => {
      const errors = await errorsFor(CreatePurchaseOrderPaymentDto, { amount: 100.5, paidAt: '2026-08-20', currency: 'EUR' });
      expect(errors).toHaveLength(0);
    });
  });

  describe('CreatePurchaseOrderDocumentDto', () => {
    it('rejects a missing documentType', async () => {
      const errors = await errorsFor(CreatePurchaseOrderDocumentDto, { counterpartyId: '3fa85f64-5717-4562-b3fc-2c963f66afa6' });
      expect(errors.some((e) => e.property === 'documentType')).toBe(true);
    });

    it('rejects a non-UUID counterpartyId', async () => {
      const errors = await errorsFor(CreatePurchaseOrderDocumentDto, { documentType: 'INVOICE', counterpartyId: 'not-a-uuid' });
      expect(errors.some((e) => e.property === 'counterpartyId')).toBe(true);
    });

    it('rejects a zero amount when provided (omit it instead for an amount-less document)', async () => {
      const errors = await errorsFor(CreatePurchaseOrderDocumentDto, {
        documentType: 'PACKING_LIST',
        counterpartyId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        amount: 0,
      });
      expect(errors.some((e) => e.property === 'amount')).toBe(true);
    });

    it('accepts omitting amount entirely', async () => {
      const errors = await errorsFor(CreatePurchaseOrderDocumentDto, {
        documentType: 'PACKING_LIST',
        counterpartyId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      });
      expect(errors).toHaveLength(0);
    });
  });

  describe('CreatePurchaseOrderExpenseDto', () => {
    it('rejects an unknown category', async () => {
      const errors = await errorsFor(CreatePurchaseOrderExpenseDto, { category: 'BRIBE', amount: 10 });
      expect(errors.some((e) => e.property === 'category')).toBe(true);
    });

    it('rejects a negative amount', async () => {
      const errors = await errorsFor(CreatePurchaseOrderExpenseDto, { category: 'OTHER', amount: -1 });
      expect(errors.some((e) => e.property === 'amount')).toBe(true);
    });

    it('rejects a non-UUID documentId when provided', async () => {
      const errors = await errorsFor(CreatePurchaseOrderExpenseDto, { category: 'OTHER', amount: 10, documentId: 'nope' });
      expect(errors.some((e) => e.property === 'documentId')).toBe(true);
    });
  });
});
