import { apiClient } from './http';
import type { DecimalString } from './decimal';
import type { Currency } from './settings';

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
  /** виріб ordered directly from the supplier instead of a товар — at most one of productId/assemblyId is set. */
  assemblyId: string | null;
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
  /** Which DeliverySchedule version is currently operative for this line — null until someone creates the first one. Never points at a PROPOSED version. */
  currentDeliveryScheduleId: string | null;
  /** Full version history (Phase 1) — includes SUPERSEDED/REJECTED rows on purpose, for a transparent history in the UI. */
  deliverySchedules?: DeliverySchedule[];
  /** Only present on supplier-portal responses (SupplierPortalService#getPurchaseOrder) — the linked product's own PRODUCT_PHOTO, if any. */
  photoUrl?: string | null;
  /** "Склад" — the supplier's own declared qty already finished and sitting at their premises, not yet shipped. Supplier-entered only. */
  supplierReadyQty: DecimalString | null;
}

export type DeliveryScheduleStatus = 'PENDING' | 'PROPOSED' | 'CONFIRMED' | 'REJECTED' | 'SUPERSEDED';

export interface DeliveryScheduleLine {
  id: string;
  date: string;
  qty: DecimalString;
}

export interface DeliverySchedule {
  id: string;
  versionNumber: number;
  status: DeliveryScheduleStatus;
  previousVersionId: string | null;
  createdById: string;
  createdAt: string;
  respondedById: string | null;
  respondedAt: string | null;
  lines: DeliveryScheduleLine[];
}

export interface PurchaseOrder {
  id: string;
  companyId: string;
  /** "ЗАМ-2026-0001" — atomic per-company counter (2026-11-04), same mechanism as PurchaseRequest.number. */
  number: string;
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
  /** Present on findOne() responses — "приписка щоб розуміти з якого замовлення береться ця заявка" (2026-11-09), resolved from sourceCustomerOrderId. */
  sourceCustomerOrder?: { id: string; orderNumber: string | null } | null;
  /** Multi-currency module (2026-10-29) — on the PO header, not per item: covers every item's expectedPrice/actualPrice/supplierConfirmedPrice under this order. */
  currency: Currency;
  createdById: string;
  createdAt: string;
  /** System-rendered via PurchaseOrderPdfService#generatePdf (2026-11-04) — the document staff hand/email to the supplier. Null until generated at least once. */
  pdfFileId: string | null;
  /** "чомусь воно зробило кожну заявку окремим замовленням постачальнику а не одним файлом" (2026-11-09) — the one combined PDF shared across every sibling order fanned out from the same заявка conversion, see generateCombinedPurchaseOrderPdf. Null until generated, and for an ordinary (never fanned-out) order. */
  combinedPdfFileId: string | null;
  /** Present on create/findOne/receive responses; not on query() list rows. */
  items?: PurchaseOrderItem[];
}

/** Every sibling order fanned out from the same заявка conversion as the one requested (including itself) — see PurchaseOrdersService#getBatch. */
export interface PurchaseOrderBatch {
  purchaseOrders: {
    id: string;
    number: string;
    sourceCustomerOrderId: string | null;
    sourceCustomerOrder: { id: string; orderNumber: string | null } | null;
  }[];
}

export interface CreatePurchaseOrderItemInput {
  productId?: string;
  /** Order a виріб directly from the supplier instead of a товар — at most one of productId/assemblyId may be set. */
  assemblyId?: string;
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
  currency?: Currency;
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
/** Renders and stores a PDF of the order's CURRENT state (overwrites any previous pdfFileId) — the document staff hand/email to the supplier. */
export function generatePurchaseOrderPdf(id: string): Promise<PurchaseOrder> {
  return apiClient.post<PurchaseOrder>(`purchase-orders/${id}/pdf`);
}
/** Every sibling order fanned out from the same заявка conversion as this one, each with its own source customer order — "приписка щоб розуміти з якого замовлення береться ця заявка". */
export function getPurchaseOrderBatch(id: string): Promise<PurchaseOrderBatch> {
  return apiClient.get<PurchaseOrderBatch>(`purchase-orders/${id}/batch`);
}
/** Renders and stores ONE combined PDF across every sibling order in this batch (overwrites any previous one) — "одним файлом" for the supplier, even though each customer order still keeps its own PurchaseOrder for Finance. */
export function generateCombinedPurchaseOrderPdf(id: string): Promise<PurchaseOrder> {
  return apiClient.post<PurchaseOrder>(`purchase-orders/${id}/combined-pdf`);
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

export interface DeliveryScheduleLineInput {
  date: string;
  qty: number;
}

/** Staff-side: creates the first Delivery Schedule version for an item (Phase 1) — only allowed while the item has none yet. */
export function createDeliverySchedule(orderId: string, itemId: string, lines: DeliveryScheduleLineInput[]): Promise<DeliverySchedule> {
  return apiClient.post<DeliverySchedule>(`purchase-orders/${orderId}/items/${itemId}/delivery-schedule`, { lines });
}

/** Staff-side: accepts a supplier's proposed delivery schedule — becomes the item's confirmed current version. */
export function acceptDeliverySchedule(orderId: string, scheduleId: string): Promise<DeliverySchedule> {
  return apiClient.post<DeliverySchedule>(`purchase-orders/${orderId}/delivery-schedule/${scheduleId}/accept`, {});
}

/** Staff-side: rejects a supplier's proposed delivery schedule — the current version is left untouched. */
export function rejectDeliverySchedule(orderId: string, scheduleId: string): Promise<DeliverySchedule> {
  return apiClient.post<DeliverySchedule>(`purchase-orders/${orderId}/delivery-schedule/${scheduleId}/reject`, {});
}

/**
 * "fill once for the group" (2026-11-03) — a PurchaseOrderItem fanned out
 * from the same aggregated заявка line as others, across one or more
 * customer orders. Empty array when this item has no siblings.
 */
export interface DeliveryScheduleSibling {
  id: string;
  purchaseOrderId: string;
  productId: string | null;
  articleSnapshot: string;
  productNameSnapshot: string;
  qtyOrdered: DecimalString;
  currentDeliveryScheduleId: string | null;
  customerOrderId: string | null;
  customerOrderNumber: string | null;
  customerOrderDeadline: string | null;
}

export function getDeliveryScheduleSiblings(itemId: string): Promise<DeliveryScheduleSibling[]> {
  return apiClient.get<DeliveryScheduleSibling[]>(`purchase-orders/items/${itemId}/delivery-schedule-siblings`);
}

export interface BulkCreateDeliveryScheduleInput {
  purchaseOrderItemIds: string[];
  lines: DeliveryScheduleLineInput[];
}

/** Splits each line's qty proportionally across the group's items and creates each item's own first version — see PurchaseOrdersService#createGroupedDeliverySchedule. */
export function createGroupedDeliverySchedule(dto: BulkCreateDeliveryScheduleInput): Promise<DeliverySchedule[]> {
  return apiClient.post<DeliverySchedule[]>('purchase-orders/delivery-schedules/bulk-create', dto);
}

/** Phase 2 — the discussion thread for a purchase order, staff and connected supplier alike. */
export interface PurchaseOrderComment {
  id: string;
  purchaseOrderId: string;
  authorType: 'STAFF' | 'SUPPLIER';
  authorUserId: string | null;
  authorSupplierPortalUserId: string | null;
  body: string;
  createdAt: string;
}

export function listPurchaseOrderComments(orderId: string): Promise<PurchaseOrderComment[]> {
  return apiClient.get<PurchaseOrderComment[]>(`purchase-orders/${orderId}/comments`);
}

export function addPurchaseOrderComment(orderId: string, body: string): Promise<PurchaseOrderComment> {
  return apiClient.post<PurchaseOrderComment>(`purchase-orders/${orderId}/comments`, { body });
}

/**
 * Заявка на прорахунок постачальнику (2026-10-21) — a non-committal,
 * single-supplier quote request. Deliberately a separate entity from
 * PurchaseOrder, not an earlier status on it (see the backend model's own
 * schema.prisma comment). Internal-only for now — no supplier-portal
 * exposure, no PDF/email; staff negotiate manually and convert it into a
 * real PurchaseOrder once ready.
 */
export type PurchaseRequestStatus = 'DRAFT' | 'SENT' | 'CONVERTED' | 'CANCELLED';

export interface PurchaseRequestItem {
  id: string;
  companyId: string;
  purchaseRequestId: string;
  productId: string | null;
  articleSnapshot: string;
  productNameSnapshot: string;
  qty: DecimalString;
  expectedPrice: DecimalString | null;
  /** The supplier's own typed-in quote via the supplier portal — informational; convertToOrder() prefers it over expectedPrice when set. */
  supplierQuotedPrice: DecimalString | null;
  /** FileAsset ids (from this line's linked product's own PRODUCT_DOCUMENT attachments) merged as extra pages onto the generated PDF. */
  attachedFileIds: string[];
  /** Only present on supplier-portal responses (SupplierPortalService#getPurchaseRequest) — the linked product's own PRODUCT_PHOTO, if any. */
  photoUrl?: string | null;
  /** Only present on supplier-portal responses — this supplier's own existing catalog price (ProductSupplier.supplierOfferedPrice) for this line's product, if any. Lets the quote form pre-fill a not-yet-quoted line instead of leaving it blank ("в наступних заявках автоматично підтягуватися", 2026-11-09). Real JSON number, not a Prisma Decimal field. */
  catalogPrice?: number | null;
  /** Only present on supplier-portal responses — attachedFileIds resolved to downloadable files (a stale/deleted id is silently dropped, not errored). */
  attachedFiles?: { id: string; originalName: string; downloadUrl: string }[];
  /** OrderMaterialRequirement ids this line aggregates (shortage picker, 2026-11-03) — carry forward into requirementIds on a subsequent saveItems() call, or the claim is silently dropped same as any other field not round-tripped through PurchaseRequestItemInput. */
  fulfilledRequirements?: { id: string }[];
}

export interface PurchaseRequest {
  id: string;
  companyId: string;
  number: string;
  supplierId: string | null;
  supplierNameSnapshot: string;
  status: PurchaseRequestStatus;
  comment: string | null;
  /** "Від кого" block on the generated PDF — free text; null/empty renders blank (no default to the company's own name). */
  fromName: string | null;
  /** Set once "Перетворити на замовлення" succeeds — presence alone blocks re-conversion. */
  convertedPurchaseOrderId: string | null;
  createdById: string;
  createdAt: string;
  sentAt: string | null;
  /** Set/overwritten each time the supplier submits (or re-submits) a quote via the portal — mirrors PurchaseOrder.supplierConfirmedAt. */
  supplierRespondedAt: string | null;
  /** Set/overwritten each time "Сформувати PDF" is used — rendered from whatever is filled in at that moment, independent of status/sentAt. */
  pdfFileId: string | null;
  /** Present on create/findOne/saveItems responses; not on query() list rows. */
  items?: PurchaseRequestItem[];
}

export interface PurchaseRequestItemInput {
  productId?: string;
  articleSnapshot: string;
  productNameSnapshot: string;
  qty: number;
  expectedPrice?: number;
  attachedFileIds?: string[];
  /** OrderMaterialRequirement ids this line aggregates (shortage picker, 2026-11-03) — may span several customer orders needing the same product. */
  requirementIds?: string[];
}

export interface CreatePurchaseRequestInput {
  supplierId?: string;
  supplierNameSnapshot: string;
  comment?: string;
  /** "Від кого" block on the generated PDF — free text, defaults to the company's own name at render time when omitted/empty. */
  fromName?: string;
  items: PurchaseRequestItemInput[];
}

/** Header-only — items go through saveItems (full bulk replace). */
/** `fromName: null` clears a previously-set override back to blank; an omitted key leaves it untouched. `number` is editable (2026-10-21 user request) — must stay unique per company. */
export type UpdatePurchaseRequestInput = Partial<Omit<CreatePurchaseRequestInput, 'items' | 'fromName'>> & { fromName?: string | null; number?: string };

export interface QueryPurchaseRequestsInput {
  status?: PurchaseRequestStatus;
  supplierId?: string;
  limit?: number;
  offset?: number;
}

export interface PaginatedPurchaseRequests {
  items: PurchaseRequest[];
  total: number;
  limit: number;
  offset: number;
}

export function queryPurchaseRequests(query: QueryPurchaseRequestsInput = {}): Promise<PaginatedPurchaseRequests> {
  return apiClient.get<PaginatedPurchaseRequests>('purchase-requests', { query: query as Record<string, string | number> });
}
export function getPurchaseRequest(id: string): Promise<PurchaseRequest> {
  return apiClient.get<PurchaseRequest>(`purchase-requests/${id}`);
}
export function createPurchaseRequest(dto: CreatePurchaseRequestInput): Promise<PurchaseRequest> {
  return apiClient.post<PurchaseRequest>('purchase-requests', dto);
}
export function updatePurchaseRequest(id: string, dto: UpdatePurchaseRequestInput): Promise<PurchaseRequest> {
  return apiClient.patch<PurchaseRequest>(`purchase-requests/${id}`, dto);
}
/** Full bulk replace — same convention as Quotations' saveItems. */
export function savePurchaseRequestItems(id: string, items: PurchaseRequestItemInput[]): Promise<PurchaseRequest> {
  return apiClient.patch<PurchaseRequest>(`purchase-requests/${id}/items`, { items });
}
/** DRAFT -> SENT marker only (no PDF/email) — editing stays allowed afterward. */
export function sendPurchaseRequest(id: string): Promise<PurchaseRequest> {
  return apiClient.post<PurchaseRequest>(`purchase-requests/${id}/send`);
}
/** Renders and stores a PDF of the request's CURRENT state (overwrites any previous pdfFileId) — allowed in any non-deleted status, unlike Quotation's send(). */
export function generatePurchaseRequestPdf(id: string): Promise<PurchaseRequest> {
  return apiClient.post<PurchaseRequest>(`purchase-requests/${id}/pdf`);
}
export function cancelPurchaseRequest(id: string): Promise<PurchaseRequest> {
  return apiClient.post<PurchaseRequest>(`purchase-requests/${id}/cancel`);
}
/**
 * `purchaseOrders` carries the full fan-out (2026-11-03) when the request
 * had lines aggregated from several customer orders' shortages — one
 * PurchaseOrder per distinct order. `purchaseOrder` stays the first one,
 * for the ordinary single-order case.
 */
export function convertPurchaseRequestToOrder(
  id: string,
): Promise<{ purchaseOrder: PurchaseOrder; purchaseOrders: PurchaseOrder[]; purchaseRequest: PurchaseRequest }> {
  return apiClient.post<{ purchaseOrder: PurchaseOrder; purchaseOrders: PurchaseOrder[]; purchaseRequest: PurchaseRequest }>(
    `purchase-requests/${id}/convert-to-order`,
  );
}
/** DRAFT only — use cancelPurchaseRequest for a sent one. */
export function deletePurchaseRequest(id: string): Promise<{ ok: true }> {
  return apiClient.delete<{ ok: true }>(`purchase-requests/${id}`);
}
