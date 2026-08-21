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

export interface SupplierPortalUserStatus {
  email: string;
  active: boolean;
  createdAt: string;
}

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
  /** null if this supplier has no Supplier Portal login yet (ADR-0011). Present on both findOne(id) and query() list rows. */
  portalUser?: SupplierPortalUserStatus | null;
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

/**
 * Creates (or resets) this supplier's Supplier Portal login — see ADR-0011.
 * `tempPassword` is shown once; it isn't retrievable again after this
 * response. Multi-company redesign (2026-08-21, ADR-0012): if the email
 * already belongs to a DIFFERENT company's connected Supplier Organization,
 * no account/password is created at all — instead a PENDING
 * SupplierConnection is created and `requiresAcceptance: true` comes back
 * (the supplier must accept it from their own portal before this company's
 * data becomes visible to them).
 */
export function invitePortal(
  id: string,
  dto: { email?: string } = {},
): Promise<{ email: string; tempPassword?: string; requiresAcceptance?: boolean }> {
  return apiClient.post<{ email: string; tempPassword?: string; requiresAcceptance?: boolean }>(`suppliers/${id}/portal-invite`, dto);
}
/** Reverse view of ProductSupplierLink — the products this supplier is linked to (Supplier detail page). */
export interface SupplierLinkedProduct {
  id: string;
  productId: string;
  productArticle: string;
  productName: string;
  price: DecimalString | null;
  isDefault: boolean;
}

/** Same as SupplierLinkedProduct, for assemblies ("вироби") bought whole from this supplier. */
export interface SupplierLinkedAssembly {
  id: string;
  assemblyId: string;
  assemblyArticle: string | null;
  assemblyName: string;
  price: DecimalString | null;
  isDefault: boolean;
}

export function getSupplierLinkedProducts(supplierId: string): Promise<SupplierLinkedProduct[]> {
  return apiClient.get<SupplierLinkedProduct[]>(`suppliers/${supplierId}/products`);
}

export function getSupplierLinkedAssemblies(supplierId: string): Promise<SupplierLinkedAssembly[]> {
  return apiClient.get<SupplierLinkedAssembly[]>(`suppliers/${supplierId}/assemblies`);
}

export function deactivatePortal(id: string): Promise<{ email: string; active: boolean }> {
  return apiClient.post<{ email: string; active: boolean }>(`suppliers/${id}/portal-deactivate`, {});
}

/**
 * Self-service registration (2026-08-21 P1, ADR-0013) — generates a
 * single-use invite link for a supplier that has no portal connection yet,
 * for when staff don't already know their exact portal email. The raw
 * `token` is shown once; it isn't retrievable again after this response.
 */
export function createSupplierInviteLink(id: string): Promise<{ token: string; expiresAt: string }> {
  return apiClient.post<{ token: string; expiresAt: string }>(`suppliers/${id}/invite-links`, {});
}

/**
 * Search-and-connect (2026-08-21 P2) — for a supplier who already
 * self-registered a Supplier Portal account independently. Creates a new
 * Supplier row for this company plus a PENDING connection request.
 */
export function connectExistingSupplier(dto: { email: string; name: string }): Promise<{ supplierId: string; requiresAcceptance: boolean }> {
  return apiClient.post<{ supplierId: string; requiresAcceptance: boolean }>('suppliers/connect-existing', dto);
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
  /** Supplier's own confirmed price via the Supplier Portal (ADR-0011) — informational, never overwrites expectedPrice/actualPrice. */
  supplierConfirmedPrice: DecimalString | null;
  /** Stock-reservation spec §5/§9: links this line to the customer-order material requirement it's covering — receiving it auto-reserves for that order. */
  sourceRequirementId: string | null;
}

export interface PurchaseOrder {
  id: string;
  companyId: string;
  supplierId: string | null;
  supplierNameSnapshot: string;
  status: PurchaseOrderStatus;
  orderDate: string;
  expectedDeliveryDate: string | null;
  /** Staff-tracked supplier-request timeline (Склад's "Очікується від постачальника" tab) — independent of status/qtyReceived, manually set/corrected. */
  plannedSendAt: string | null;
  sentToSupplierAt: string | null;
  shippedBySupplierAt: string | null;
  deliveredAt: string | null;
  /** Set once, the first time the supplier confirms anything via the Supplier Portal. */
  supplierConfirmedAt: string | null;
  /** Supplier's own committed delivery date — informational, never overwrites expectedDeliveryDate. */
  supplierConfirmedDeliveryDate: string | null;
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
  /** Stock-reservation spec §5/§9 — set when this line is being bought specifically to cover a customer order's material requirement. */
  sourceRequirementId?: string;
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
/** Permanent hard delete — admin-only (`purchase-orders:delete`), cannot be undone. Stock movements already posted against it (receiving) keep their own independent record. */
export function deletePurchaseOrder(id: string): Promise<{ ok: true }> {
  return apiClient.delete<{ ok: true }>(`purchase-orders/${id}`);
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

export interface UpdatePurchaseOrderMilestonesInput {
  /** `null` clears the date; an omitted key leaves it untouched. */
  plannedSendAt?: string | null;
  sentToSupplierAt?: string | null;
  shippedBySupplierAt?: string | null;
  deliveredAt?: string | null;
}

export function updatePurchaseOrderMilestones(
  id: string,
  dto: UpdatePurchaseOrderMilestonesInput,
): Promise<PurchaseOrder> {
  return apiClient.patch<PurchaseOrder>(`purchase-orders/${id}/milestones`, dto);
}
