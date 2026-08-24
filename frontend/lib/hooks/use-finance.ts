'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listFinancePurchaseOrders,
  getPurchaseOrderFinanceSummary,
  listPurchaseOrderDocuments,
  createPurchaseOrderDocument,
  getFinanceDocument,
  updateFinanceDocument,
  deleteFinanceDocument,
  addFinancePayment,
  deleteFinancePayment,
  listPurchaseOrderExpenses,
  createPurchaseOrderExpense,
  updateFinanceExpense,
  deleteFinanceExpense,
  type QueryFinancePurchaseOrdersInput,
  type CreatePurchaseOrderDocumentInput,
  type UpdatePurchaseOrderDocumentInput,
  type CreatePurchaseOrderPaymentInput,
  type CreatePurchaseOrderExpenseInput,
  type UpdatePurchaseOrderExpenseInput,
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
