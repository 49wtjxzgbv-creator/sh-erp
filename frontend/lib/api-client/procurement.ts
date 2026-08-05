import { apiClient } from './http';
import type { DecimalString } from './decimal';

/**
 * Typed wrappers for backend/src/modules/procurement/ (SuppliersController,
 * PurchaseOrdersController). Field shapes copied verbatim from
 * dto/supplier.dto.ts, dto/query-suppliers.dto.ts, dto/purchase-order.dto.ts,
 * dto/receive-purchase-order.dto.ts, and schema.prisma's
 * Supplier/PurchaseOrder/PurchaseOrderItem models.
 *
 * All endpoints here are plain CRUD/findOne/query/receive over Prisma rows
 * (no computed-result split like BOM's cost/availability/produce), so every
 * Decimal field (qtyOrdered/qtyReceived/expectedPrice/actualPrice) is a
 * DecimalString as usual.
 */

export interface Supplier {
  id: string;
  companyId: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateSupplierInput {
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  notes?: string;
}

export type UpdateSupplierInput = Partial<CreateSupplierInput>;

export interface QuerySuppliersInput {
  search?: string;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
}

export interface PaginatedSuppliers {
  items: Supplier[];
  total: number;
  limit: number;
  offset: number;
}

export function querySuppliers(query: QuerySuppliersInput = {}): Promise<PaginatedSuppliers> {
  return apiClient.get<PaginatedSuppliers>('suppliers', { query: query as Record<string, string | number | boolean> });
}
export function getSupplier(id: string): Promise<Supplier> {
  return apiClient.get<Supplier>(`suppliers/${id}`);
}
export function createSupplier(dto: CreateSupplierInput): Promise<Supplier> {
  return apiClient.post<Supplier>('suppliers', dto);
}
export function updateSupplier(id: string, dto: UpdateSupplierInput): Promise<Supplier> {
  return apiClient.patch<Supplier>(`suppliers/${id}`, dto);
}
/** Soft-delete, no in-use guard — matches the legacy behavior (Phase 1 §3.4). */
export function deleteSupplier(id: string): Promise<{ ok: true }> {
  return apiClient.delete<{ ok: true }>(`suppliers/${id}`);
}

export type PurchaseOrderStatus = 'ORDERED' | 'PARTIAL' | 'DELIVERED';

export interface PurchaseOrderItem {
  id: string;
  companyId: string;
  purchaseOrderId: string;
  productId: string | null;
  articleSnapshot: string;
  productNameSnapshot: string;
  qtyOrdered: DecimalString;
  qtyReceived: DecimalString;
  expectedPrice: DecimalString | null;
  actualPrice: DecimalString | null;
}

export interface PurchaseOrder {
  id: string;
  companyId: string;
  supplierId: string | null;
  supplierNameSnapshot: string;
  status: PurchaseOrderStatus;
  orderDate: string;
  expectedDeliveryDate: string | null;
  comment: string | null;
  sourceCustomerOrderId: string | null;
  createdById: string;
  createdAt: string;
  /** Present on create/findOne/receive responses; not on query() list rows. */
  items?: PurchaseOrderItem[];
}

export interface CreatePurchaseOrderItemInput {
  productId?: string;
  articleSnapshot: string;
  productNameSnapshot: string;
  qtyOrdered: number;
  expectedPrice?: number;
}

export interface CreatePurchaseOrderInput {
  supplierId?: string;
  supplierNameSnapshot: string;
  expectedDeliveryDate?: string;
  comment?: string;
  sourceCustomerOrderId?: string;
  items: CreatePurchaseOrderItemInput[];
}

export interface QueryPurchaseOrdersInput {
  status?: PurchaseOrderStatus;
  supplierId?: string;
  limit?: number;
  offset?: number;
}

export interface PaginatedPurchaseOrders {
  items: PurchaseOrder[];
  total: number;
  limit: number;
  offset: number;
}

export function queryPurchaseOrders(query: QueryPurchaseOrdersInput = {}): Promise<PaginatedPurchaseOrders> {
  return apiClient.get<PaginatedPurchaseOrders>('purchase-orders', { query: query as Record<string, string | number> });
}
export function getPurchaseOrder(id: string): Promise<PurchaseOrder> {
  return apiClient.get<PurchaseOrder>(`purchase-orders/${id}`);
}
export function createPurchaseOrder(dto: CreatePurchaseOrderInput): Promise<PurchaseOrder> {
  return apiClient.post<PurchaseOrder>('purchase-orders', dto);
}

export interface ReceivePurchaseOrderLineInput {
  purchaseOrderItemId: string;
  /** Delta received in THIS event, not a running total — receiving can happen across multiple partial deliveries. */
  qtyReceived: number;
  actualPrice?: number;
}

export interface ReceivePurchaseOrderInput {
  warehouseId?: string;
  lines: ReceivePurchaseOrderLineInput[];
}

/**
 * Updates qtyReceived per line, posts a RECEIVE stock movement for every
 * line with a linked productId, and recomputes ORDERED/PARTIAL/DELIVERED.
 * No cap against over-receiving beyond qtyOrdered — same "no hidden
 * arithmetic" philosophy as the rest of the backend (record reality).
 */
export function receivePurchaseOrder(id: string, dto: ReceivePurchaseOrderInput): Promise<PurchaseOrder> {
  return apiClient.post<PurchaseOrder>(`purchase-orders/${id}/receive`, dto);
}
