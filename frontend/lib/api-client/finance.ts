import { apiClient } from './http';
import type { DecimalString } from './decimal';
import type { PurchaseOrderStatus } from './procurement';

/**
 * Typed wrappers for backend/src/modules/finance/ (FinanceController).
 * Field shapes copied verbatim from dto/finance-document.dto.ts,
 * dto/finance-payment.dto.ts, dto/finance-expense.dto.ts, and
 * finance.service.ts's PurchaseOrderFinanceSummary/FinanceCurrencyBucket.
 *
 * Six summary numbers, deliberately never blended (see finance.service.ts's
 * own header comment for the full rationale — confirmed in chat 2026-08-24):
 * goodsCost + additionalExpenses = actualCost; totalDocuments - paid =
 * unpaidPerDocuments, which is NOT the same as actualCost - paid (an expense
 * can exist before its confirming document/invoice ever arrives).
 */

export type FinancePaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID';
export type DocumentPaymentStatus = 'NO_AMOUNT' | FinancePaymentStatus;

export type PurchaseOrderDocumentType =
  | 'INVOICE'
  | 'DELIVERY_NOTE'
  | 'PROFORMA_INVOICE'
  | 'PACKING_LIST'
  | 'TRANSPORT_DOCUMENT'
  | 'CUSTOMS_DOCUMENT'
  | 'ACT'
  | 'OTHER';

export type PurchaseOrderExpenseCategory = 'SHIPPING' | 'CUSTOMS' | 'INSURANCE' | 'OTHER';

export interface FinanceCurrencyBucket {
  currency: string;
  additionalExpenses: number;
  totalDocuments: number;
  paid: number;
  unpaidPerDocuments: number;
}

export interface PurchaseOrderFinanceSummary {
  purchaseOrderId: string;
  primaryCurrency: string;
  goodsCost: number;
  additionalExpenses: number;
  actualCost: number;
  totalDocuments: number;
  paid: number;
  unpaidPerDocuments: number;
  documentCount: number;
  lastActivityAt: string | null;
  otherCurrencies: FinanceCurrencyBucket[];
}

export interface FinancePurchaseOrderRow {
  purchaseOrder: {
    id: string;
    supplierNameSnapshot: string;
    supplierId: string | null;
    status: PurchaseOrderStatus;
    orderDate: string;
  };
  summary: PurchaseOrderFinanceSummary;
  paymentStatus: FinancePaymentStatus;
}

export interface QueryFinancePurchaseOrdersInput {
  search?: string;
  paymentStatus?: FinancePaymentStatus;
  supplierId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

export interface PaginatedFinancePurchaseOrders {
  items: FinancePurchaseOrderRow[];
  total: number;
  limit: number;
  offset: number;
}

export function listFinancePurchaseOrders(query: QueryFinancePurchaseOrdersInput = {}): Promise<PaginatedFinancePurchaseOrders> {
  return apiClient.get<PaginatedFinancePurchaseOrders>('finance/purchase-orders', { query: query as Record<string, string | number> });
}

export function getPurchaseOrderFinanceSummary(purchaseOrderId: string): Promise<PurchaseOrderFinanceSummary> {
  return apiClient.get<PurchaseOrderFinanceSummary>(`finance/purchase-orders/${purchaseOrderId}/summary`);
}

export interface PurchaseOrderPayment {
  id: string;
  documentId: string;
  amount: DecimalString;
  currency: string;
  paidAt: string;
  method: string | null;
  note: string | null;
  createdById: string;
  createdAt: string;
  /** Only present on the response of addPayment() — true when this payment's currency differs from its document's. */
  currencyMismatch?: boolean;
}

export interface PurchaseOrderDocument {
  id: string;
  purchaseOrderId: string;
  documentType: PurchaseOrderDocumentType;
  documentNumber: string | null;
  documentDate: string | null;
  counterpartyId: string;
  counterparty?: { id: string; name: string };
  amount: DecimalString | null;
  currency: string;
  note: string | null;
  createdById: string;
  createdAt: string;
  payments: PurchaseOrderPayment[];
  paymentStatus: DocumentPaymentStatus;
}

export interface CreatePurchaseOrderDocumentInput {
  documentType: PurchaseOrderDocumentType;
  documentNumber?: string;
  documentDate?: string;
  counterpartyId: string;
  amount?: number;
  currency?: string;
  note?: string;
}

export type UpdatePurchaseOrderDocumentInput = Partial<Omit<CreatePurchaseOrderDocumentInput, 'amount'>> & { amount?: number | null };

export function listPurchaseOrderDocuments(purchaseOrderId: string): Promise<PurchaseOrderDocument[]> {
  return apiClient.get<PurchaseOrderDocument[]>(`finance/purchase-orders/${purchaseOrderId}/documents`);
}

export function createPurchaseOrderDocument(purchaseOrderId: string, dto: CreatePurchaseOrderDocumentInput): Promise<PurchaseOrderDocument> {
  return apiClient.post<PurchaseOrderDocument>(`finance/purchase-orders/${purchaseOrderId}/documents`, dto);
}

export function getFinanceDocument(id: string): Promise<PurchaseOrderDocument> {
  return apiClient.get<PurchaseOrderDocument>(`finance/documents/${id}`);
}

export function updateFinanceDocument(id: string, dto: UpdatePurchaseOrderDocumentInput): Promise<PurchaseOrderDocument> {
  return apiClient.patch<PurchaseOrderDocument>(`finance/documents/${id}`, dto);
}

export function deleteFinanceDocument(id: string): Promise<{ ok: true }> {
  return apiClient.delete<{ ok: true }>(`finance/documents/${id}`);
}

export interface CreatePurchaseOrderPaymentInput {
  amount: number;
  currency?: string;
  paidAt: string;
  method?: string;
  note?: string;
}

export type UpdatePurchaseOrderPaymentInput = Partial<CreatePurchaseOrderPaymentInput>;

export function addFinancePayment(documentId: string, dto: CreatePurchaseOrderPaymentInput): Promise<PurchaseOrderPayment> {
  return apiClient.post<PurchaseOrderPayment>(`finance/documents/${documentId}/payments`, dto);
}

export function updateFinancePayment(id: string, dto: UpdatePurchaseOrderPaymentInput): Promise<PurchaseOrderPayment> {
  return apiClient.patch<PurchaseOrderPayment>(`finance/payments/${id}`, dto);
}

export function deleteFinancePayment(id: string): Promise<{ ok: true }> {
  return apiClient.delete<{ ok: true }>(`finance/payments/${id}`);
}

export interface PurchaseOrderExpense {
  id: string;
  purchaseOrderId: string;
  category: PurchaseOrderExpenseCategory;
  amount: DecimalString;
  currency: string;
  description: string | null;
  documentId: string | null;
  createdById: string;
  createdAt: string;
}

export interface CreatePurchaseOrderExpenseInput {
  category: PurchaseOrderExpenseCategory;
  amount: number;
  currency?: string;
  description?: string;
  documentId?: string;
}

export type UpdatePurchaseOrderExpenseInput = Partial<Omit<CreatePurchaseOrderExpenseInput, 'documentId'>> & { documentId?: string | null };

export function listPurchaseOrderExpenses(purchaseOrderId: string): Promise<PurchaseOrderExpense[]> {
  return apiClient.get<PurchaseOrderExpense[]>(`finance/purchase-orders/${purchaseOrderId}/expenses`);
}

export function createPurchaseOrderExpense(purchaseOrderId: string, dto: CreatePurchaseOrderExpenseInput): Promise<PurchaseOrderExpense> {
  return apiClient.post<PurchaseOrderExpense>(`finance/purchase-orders/${purchaseOrderId}/expenses`, dto);
}

export function updateFinanceExpense(id: string, dto: UpdatePurchaseOrderExpenseInput): Promise<PurchaseOrderExpense> {
  return apiClient.patch<PurchaseOrderExpense>(`finance/expenses/${id}`, dto);
}

export function deleteFinanceExpense(id: string): Promise<{ ok: true }> {
  return apiClient.delete<{ ok: true }>(`finance/expenses/${id}`);
}

// ---------------------------------------------------------------------
// CustomerOrder-Finance (2026-08-24) — the `/finance` landing page's
// primary view. Cost = automatic rollup of every linked PurchaseOrder's
// own Finance data (types/functions above, unchanged) + direct documents/
// expenses recorded here. See finance.service.ts's CustomerOrderFinanceSummary
// comment for the full rationale.
// ---------------------------------------------------------------------

export interface CustomerOrderPurchaseOrderRollup {
  purchaseOrder: { id: string; supplierNameSnapshot: string; status: PurchaseOrderStatus; orderDate: string };
  summary: PurchaseOrderFinanceSummary;
}

export interface CustomerOrderFinanceSummary {
  customerOrderId: string;
  primaryCurrency: string;
  purchaseCost: number;
  additionalExpenses: number;
  actualCost: number;
  totalDocuments: number;
  paid: number;
  unpaidPerDocuments: number;
  documentCount: number;
  lastActivityAt: string | null;
  otherCurrencies: FinanceCurrencyBucket[];
  purchaseOrders: CustomerOrderPurchaseOrderRollup[];
}

export interface FinanceCustomerOrderRow {
  customerOrder: { id: string; clientName: string; orderNumber: string | null; status: string; createdAt: string };
  summary: CustomerOrderFinanceSummary;
  paymentStatus: FinancePaymentStatus;
}

export interface QueryFinanceCustomerOrdersInput {
  search?: string;
  paymentStatus?: FinancePaymentStatus;
  limit?: number;
  offset?: number;
}

export interface PaginatedFinanceCustomerOrders {
  items: FinanceCustomerOrderRow[];
  total: number;
  limit: number;
  offset: number;
}

export function listFinanceCustomerOrders(query: QueryFinanceCustomerOrdersInput = {}): Promise<PaginatedFinanceCustomerOrders> {
  return apiClient.get<PaginatedFinanceCustomerOrders>('finance/customer-orders', { query: query as Record<string, string | number> });
}

export function getCustomerOrderFinanceSummary(customerOrderId: string): Promise<CustomerOrderFinanceSummary> {
  return apiClient.get<CustomerOrderFinanceSummary>(`finance/customer-orders/${customerOrderId}/summary`);
}

export interface CustomerOrderDocument {
  id: string;
  customerOrderId: string;
  documentType: PurchaseOrderDocumentType;
  documentNumber: string | null;
  documentDate: string | null;
  counterpartyId: string;
  counterparty?: { id: string; name: string };
  amount: DecimalString | null;
  currency: string;
  note: string | null;
  createdById: string;
  createdAt: string;
  payments: PurchaseOrderPayment[];
  paymentStatus: DocumentPaymentStatus;
}

export type CreateCustomerOrderDocumentInput = CreatePurchaseOrderDocumentInput;
export type UpdateCustomerOrderDocumentInput = UpdatePurchaseOrderDocumentInput;

export function listCustomerOrderDocuments(customerOrderId: string): Promise<CustomerOrderDocument[]> {
  return apiClient.get<CustomerOrderDocument[]>(`finance/customer-orders/${customerOrderId}/documents`);
}

export function createCustomerOrderDocument(customerOrderId: string, dto: CreateCustomerOrderDocumentInput): Promise<CustomerOrderDocument> {
  return apiClient.post<CustomerOrderDocument>(`finance/customer-orders/${customerOrderId}/documents`, dto);
}

export function getFinanceCustomerOrderDocument(id: string): Promise<CustomerOrderDocument> {
  return apiClient.get<CustomerOrderDocument>(`finance/customer-order-documents/${id}`);
}

export function updateFinanceCustomerOrderDocument(id: string, dto: UpdateCustomerOrderDocumentInput): Promise<CustomerOrderDocument> {
  return apiClient.patch<CustomerOrderDocument>(`finance/customer-order-documents/${id}`, dto);
}

export function deleteFinanceCustomerOrderDocument(id: string): Promise<{ ok: true }> {
  return apiClient.delete<{ ok: true }>(`finance/customer-order-documents/${id}`);
}

export function addFinanceCustomerOrderPayment(documentId: string, dto: CreatePurchaseOrderPaymentInput): Promise<PurchaseOrderPayment> {
  return apiClient.post<PurchaseOrderPayment>(`finance/customer-order-documents/${documentId}/payments`, dto);
}

export function updateFinanceCustomerOrderPayment(id: string, dto: UpdatePurchaseOrderPaymentInput): Promise<PurchaseOrderPayment> {
  return apiClient.patch<PurchaseOrderPayment>(`finance/customer-order-payments/${id}`, dto);
}

export function deleteFinanceCustomerOrderPayment(id: string): Promise<{ ok: true }> {
  return apiClient.delete<{ ok: true }>(`finance/customer-order-payments/${id}`);
}

export interface CustomerOrderExpense {
  id: string;
  customerOrderId: string;
  category: PurchaseOrderExpenseCategory;
  amount: DecimalString;
  currency: string;
  description: string | null;
  documentId: string | null;
  createdById: string;
  createdAt: string;
}

export type CreateCustomerOrderExpenseInput = CreatePurchaseOrderExpenseInput;
export type UpdateCustomerOrderExpenseInput = UpdatePurchaseOrderExpenseInput;

export function listCustomerOrderExpenses(customerOrderId: string): Promise<CustomerOrderExpense[]> {
  return apiClient.get<CustomerOrderExpense[]>(`finance/customer-orders/${customerOrderId}/expenses`);
}

export function createCustomerOrderExpense(customerOrderId: string, dto: CreateCustomerOrderExpenseInput): Promise<CustomerOrderExpense> {
  return apiClient.post<CustomerOrderExpense>(`finance/customer-orders/${customerOrderId}/expenses`, dto);
}

export function updateFinanceCustomerOrderExpense(id: string, dto: UpdateCustomerOrderExpenseInput): Promise<CustomerOrderExpense> {
  return apiClient.patch<CustomerOrderExpense>(`finance/customer-order-expenses/${id}`, dto);
}

export function deleteFinanceCustomerOrderExpense(id: string): Promise<{ ok: true }> {
  return apiClient.delete<{ ok: true }>(`finance/customer-order-expenses/${id}`);
}
