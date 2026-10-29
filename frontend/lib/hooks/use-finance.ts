'use client';

import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listFinancePurchaseOrders,
  getPurchaseOrderFinanceSummary,
  listPurchaseOrderDocuments,
  createPurchaseOrderDocument,
  getFinanceDocument,
  updateFinanceDocument,
  deleteFinanceDocument,
  addFinancePayment,
  updateFinancePayment,
  deleteFinancePayment,
  listPurchaseOrderExpenses,
  createPurchaseOrderExpense,
  updateFinanceExpense,
  deleteFinanceExpense,
  listFinanceCustomerOrders,
  getCustomerOrderFinanceSummary,
  listCustomerOrderDocuments,
  createCustomerOrderDocument,
  getFinanceCustomerOrderDocument,
  updateFinanceCustomerOrderDocument,
  deleteFinanceCustomerOrderDocument,
  addFinanceCustomerOrderPayment,
  updateFinanceCustomerOrderPayment,
  deleteFinanceCustomerOrderPayment,
  listCustomerOrderExpenses,
  createCustomerOrderExpense,
  updateFinanceCustomerOrderExpense,
  deleteFinanceCustomerOrderExpense,
  listExchangeRates,
  getExchangeRate,
  setExchangeRateOverride,
  syncExchangeRates,
  type Currency,
  type QueryFinancePurchaseOrdersInput,
  type CreatePurchaseOrderDocumentInput,
  type UpdatePurchaseOrderDocumentInput,
  type CreatePurchaseOrderPaymentInput,
  type UpdatePurchaseOrderPaymentInput,
  type CreatePurchaseOrderExpenseInput,
  type UpdatePurchaseOrderExpenseInput,
  type QueryFinanceCustomerOrdersInput,
  type CreateCustomerOrderDocumentInput,
  type UpdateCustomerOrderDocumentInput,
  type CreateCustomerOrderExpenseInput,
  type UpdateCustomerOrderExpenseInput,
} from '@/lib/api-client/finance';

const financePurchaseOrdersKey = (query: QueryFinancePurchaseOrdersInput) => ['finance', 'purchase-orders', query] as const;
const financeSummaryKey = (purchaseOrderId: string) => ['finance', 'summary', purchaseOrderId] as const;
const financeDocumentsKey = (purchaseOrderId: string) => ['finance', 'documents', purchaseOrderId] as const;
const financeDocumentKey = (id: string) => ['finance', 'document', id] as const;
const financeExpensesKey = (purchaseOrderId: string) => ['finance', 'expenses', purchaseOrderId] as const;

/** Invalidates every view that a document/payment/expense mutation on this PO can affect — summary, document list, single document, and the /finance list card (its own summary embeds the same numbers). */
function invalidatePurchaseOrderFinance(qc: ReturnType<typeof useQueryClient>, purchaseOrderId: string) {
  qc.invalidateQueries({ queryKey: financeSummaryKey(purchaseOrderId) });
  qc.invalidateQueries({ queryKey: financeDocumentsKey(purchaseOrderId) });
  qc.invalidateQueries({ queryKey: financeExpensesKey(purchaseOrderId) });
  qc.invalidateQueries({ queryKey: ['finance', 'purchase-orders'] });
}

export function useFinancePurchaseOrders(query: QueryFinancePurchaseOrdersInput) {
  return useQuery({ queryKey: financePurchaseOrdersKey(query), queryFn: () => listFinancePurchaseOrders(query) });
}

export function useFinanceSummary(purchaseOrderId: string | undefined) {
  return useQuery({
    queryKey: financeSummaryKey(purchaseOrderId ?? ''),
    queryFn: () => getPurchaseOrderFinanceSummary(purchaseOrderId as string),
    enabled: Boolean(purchaseOrderId),
  });
}

export function useFinanceDocuments(purchaseOrderId: string | undefined) {
  return useQuery({
    queryKey: financeDocumentsKey(purchaseOrderId ?? ''),
    queryFn: () => listPurchaseOrderDocuments(purchaseOrderId as string),
    enabled: Boolean(purchaseOrderId),
  });
}

export function useFinanceDocument(id: string | undefined) {
  return useQuery({
    queryKey: financeDocumentKey(id ?? ''),
    queryFn: () => getFinanceDocument(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateFinanceDocument(purchaseOrderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreatePurchaseOrderDocumentInput) => createPurchaseOrderDocument(purchaseOrderId, dto),
    onSuccess: () => invalidatePurchaseOrderFinance(qc, purchaseOrderId),
  });
}

export function useUpdateFinanceDocument(purchaseOrderId: string, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdatePurchaseOrderDocumentInput) => updateFinanceDocument(documentId, dto),
    onSuccess: () => {
      invalidatePurchaseOrderFinance(qc, purchaseOrderId);
      qc.invalidateQueries({ queryKey: financeDocumentKey(documentId) });
    },
  });
}

export function useDeleteFinanceDocument(purchaseOrderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => deleteFinanceDocument(documentId),
    onSuccess: () => invalidatePurchaseOrderFinance(qc, purchaseOrderId),
  });
}

export function useAddFinancePayment(purchaseOrderId: string, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreatePurchaseOrderPaymentInput) => addFinancePayment(documentId, dto),
    onSuccess: () => {
      invalidatePurchaseOrderFinance(qc, purchaseOrderId);
      qc.invalidateQueries({ queryKey: financeDocumentKey(documentId) });
    },
  });
}

export function useUpdateFinancePayment(purchaseOrderId: string, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdatePurchaseOrderPaymentInput }) => updateFinancePayment(id, dto),
    onSuccess: () => {
      invalidatePurchaseOrderFinance(qc, purchaseOrderId);
      qc.invalidateQueries({ queryKey: financeDocumentKey(documentId) });
    },
  });
}

export function useDeleteFinancePayment(purchaseOrderId: string, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (paymentId: string) => deleteFinancePayment(paymentId),
    onSuccess: () => {
      invalidatePurchaseOrderFinance(qc, purchaseOrderId);
      qc.invalidateQueries({ queryKey: financeDocumentKey(documentId) });
    },
  });
}

export function useFinanceExpenses(purchaseOrderId: string | undefined) {
  return useQuery({
    queryKey: financeExpensesKey(purchaseOrderId ?? ''),
    queryFn: () => listPurchaseOrderExpenses(purchaseOrderId as string),
    enabled: Boolean(purchaseOrderId),
  });
}

export function useCreateFinanceExpense(purchaseOrderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreatePurchaseOrderExpenseInput) => createPurchaseOrderExpense(purchaseOrderId, dto),
    onSuccess: () => invalidatePurchaseOrderFinance(qc, purchaseOrderId),
  });
}

export function useUpdateFinanceExpense(purchaseOrderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdatePurchaseOrderExpenseInput }) => updateFinanceExpense(id, dto),
    onSuccess: () => invalidatePurchaseOrderFinance(qc, purchaseOrderId),
  });
}

export function useDeleteFinanceExpense(purchaseOrderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteFinanceExpense(id),
    onSuccess: () => invalidatePurchaseOrderFinance(qc, purchaseOrderId),
  });
}

// ---------------------------------------------------------------------
// CustomerOrder-Finance (2026-08-24) — mirrors the PurchaseOrder hooks
// above exactly, one level up. See lib/api-client/finance.ts's own header
// comment for the full rationale.
// ---------------------------------------------------------------------

const financeCustomerOrdersKey = (query: QueryFinanceCustomerOrdersInput) => ['finance', 'customer-orders', query] as const;
const financeCustomerOrderSummaryKey = (customerOrderId: string) => ['finance', 'customer-order-summary', customerOrderId] as const;
const financeCustomerOrderDocumentsKey = (customerOrderId: string) => ['finance', 'customer-order-documents', customerOrderId] as const;
const financeCustomerOrderDocumentKey = (id: string) => ['finance', 'customer-order-document', id] as const;
const financeCustomerOrderExpensesKey = (customerOrderId: string) => ['finance', 'customer-order-expenses', customerOrderId] as const;

/** Invalidates every view a CustomerOrder document/payment/expense mutation can affect, PLUS the linked PurchaseOrder's own Finance views (since the order's summary rolls up that PO's data) and the /finance list (both tabs). */
function invalidateCustomerOrderFinance(qc: ReturnType<typeof useQueryClient>, customerOrderId: string) {
  qc.invalidateQueries({ queryKey: financeCustomerOrderSummaryKey(customerOrderId) });
  qc.invalidateQueries({ queryKey: financeCustomerOrderDocumentsKey(customerOrderId) });
  qc.invalidateQueries({ queryKey: financeCustomerOrderExpensesKey(customerOrderId) });
  qc.invalidateQueries({ queryKey: ['finance', 'customer-orders'] });
}

export function useFinanceCustomerOrders(query: QueryFinanceCustomerOrdersInput) {
  return useQuery({ queryKey: financeCustomerOrdersKey(query), queryFn: () => listFinanceCustomerOrders(query) });
}

export function useCustomerOrderFinanceSummary(customerOrderId: string | undefined) {
  return useQuery({
    queryKey: financeCustomerOrderSummaryKey(customerOrderId ?? ''),
    queryFn: () => getCustomerOrderFinanceSummary(customerOrderId as string),
    enabled: Boolean(customerOrderId),
  });
}

export function useCustomerOrderFinanceDocuments(customerOrderId: string | undefined) {
  return useQuery({
    queryKey: financeCustomerOrderDocumentsKey(customerOrderId ?? ''),
    queryFn: () => listCustomerOrderDocuments(customerOrderId as string),
    enabled: Boolean(customerOrderId),
  });
}

export function useCustomerOrderFinanceDocument(id: string | undefined) {
  return useQuery({
    queryKey: financeCustomerOrderDocumentKey(id ?? ''),
    queryFn: () => getFinanceCustomerOrderDocument(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateCustomerOrderDocument(customerOrderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateCustomerOrderDocumentInput) => createCustomerOrderDocument(customerOrderId, dto),
    onSuccess: () => invalidateCustomerOrderFinance(qc, customerOrderId),
  });
}

export function useUpdateCustomerOrderDocument(customerOrderId: string, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateCustomerOrderDocumentInput) => updateFinanceCustomerOrderDocument(documentId, dto),
    onSuccess: () => {
      invalidateCustomerOrderFinance(qc, customerOrderId);
      qc.invalidateQueries({ queryKey: financeCustomerOrderDocumentKey(documentId) });
    },
  });
}

export function useDeleteCustomerOrderDocument(customerOrderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => deleteFinanceCustomerOrderDocument(documentId),
    onSuccess: () => invalidateCustomerOrderFinance(qc, customerOrderId),
  });
}

export function useAddCustomerOrderPayment(customerOrderId: string, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreatePurchaseOrderPaymentInput) => addFinanceCustomerOrderPayment(documentId, dto),
    onSuccess: () => {
      invalidateCustomerOrderFinance(qc, customerOrderId);
      qc.invalidateQueries({ queryKey: financeCustomerOrderDocumentKey(documentId) });
    },
  });
}

export function useUpdateCustomerOrderPayment(customerOrderId: string, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdatePurchaseOrderPaymentInput }) => updateFinanceCustomerOrderPayment(id, dto),
    onSuccess: () => {
      invalidateCustomerOrderFinance(qc, customerOrderId);
      qc.invalidateQueries({ queryKey: financeCustomerOrderDocumentKey(documentId) });
    },
  });
}

export function useDeleteCustomerOrderPayment(customerOrderId: string, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (paymentId: string) => deleteFinanceCustomerOrderPayment(paymentId),
    onSuccess: () => {
      invalidateCustomerOrderFinance(qc, customerOrderId);
      qc.invalidateQueries({ queryKey: financeCustomerOrderDocumentKey(documentId) });
    },
  });
}

export function useCustomerOrderFinanceExpenses(customerOrderId: string | undefined) {
  return useQuery({
    queryKey: financeCustomerOrderExpensesKey(customerOrderId ?? ''),
    queryFn: () => listCustomerOrderExpenses(customerOrderId as string),
    enabled: Boolean(customerOrderId),
  });
}

export function useCreateCustomerOrderExpense(customerOrderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateCustomerOrderExpenseInput) => createCustomerOrderExpense(customerOrderId, dto),
    onSuccess: () => invalidateCustomerOrderFinance(qc, customerOrderId),
  });
}

export function useUpdateCustomerOrderExpense(customerOrderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateCustomerOrderExpenseInput }) => updateFinanceCustomerOrderExpense(id, dto),
    onSuccess: () => invalidateCustomerOrderFinance(qc, customerOrderId),
  });
}

export function useDeleteCustomerOrderExpense(customerOrderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteFinanceCustomerOrderExpense(id),
    onSuccess: () => invalidateCustomerOrderFinance(qc, customerOrderId),
  });
}

export function useExchangeRates(from?: string, to?: string) {
  return useQuery({
    queryKey: ['exchange-rates', from, to] as const,
    queryFn: () => listExchangeRates(from, to),
  });
}

export function useSetExchangeRateOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: { currency: Currency; rate: number; asOfDate: string }) => setExchangeRateOverride(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['exchange-rates'] }),
  });
}

export function useSyncExchangeRates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (days?: number) => syncExchangeRates(days),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['exchange-rates'] }),
  });
}

/**
 * Multi-currency module (2026-10-29) — replaces `useEurUahRate`
 * (use-eur-uah-rate.ts, removed) everywhere a print view used to ask the
 * user to retype a EUR->UAH rate from scratch each session. `asOfDate`
 * (YYYY-MM-DD) should be the date the printed document is actually ABOUT
 * (e.g. a payroll period's own date), not necessarily "today" — see each
 * call site's own comment for which date it passes.
 */
export function useExchangeRate(currency: Currency, asOfDate: string | undefined) {
  return useQuery({
    queryKey: ['exchange-rate', currency, asOfDate] as const,
    queryFn: () => getExchangeRate(currency, asOfDate as string),
    enabled: Boolean(asOfDate),
  });
}

/**
 * Batched `useExchangeRate` for a dynamic set of currencies — same
 * `useQueries` shape as `useAssemblyCosts` (lib/hooks/use-bom.ts), for the
 * same reason: a dynamic-length list can't call a plain `useQuery` in a
 * loop (Rules of Hooks). UAH itself is never fetched (it's the implicit
 * bridge currency — see ExchangeRatesService#convert). Returns a plain
 * `{ [currency]: rate }` map, feed it straight into `convertWithRates`
 * (lib/finance-format.ts). Shares cache entries with any other
 * `useExchangeRate` call for the same currency/date (identical queryKey).
 */
export function useCurrencyRatesMap(currencies: string[], asOfDate: string | undefined) {
  const distinct = Array.from(new Set(currencies)).filter((c) => c !== 'UAH');
  const results = useQueries({
    queries: distinct.map((currency) => ({
      queryKey: ['exchange-rate', currency, asOfDate] as const,
      queryFn: () => getExchangeRate(currency as Currency, asOfDate as string),
      enabled: Boolean(asOfDate),
    })),
  });
  const ratesToUah: Record<string, number | undefined> = {};
  distinct.forEach((currency, i) => {
    ratesToUah[currency] = results[i].data?.rate;
  });
  return ratesToUah;
}
