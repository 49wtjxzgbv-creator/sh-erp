import { apiClient } from './http';
import type { DecimalString } from './decimal';

/**
 * Typed wrappers for backend/src/modules/sales/ (CustomerOrdersController,
 * ShipmentsController). Field shapes copied verbatim from
 * dto/customer-order.dto.ts, dto/give-to-production.dto.ts,
 * dto/shortage-analysis.dto.ts, dto/shipment.dto.ts, and schema.prisma's
 * CustomerOrder/CustomerOrderItem/Shipment/ShipmentItem models.
 *
 * Same DecimalString-vs-plain-number split as BOM (lib/api-client/bom.ts):
 * the plain CRUD endpoints (create/update/findOne/query) return Prisma
 * rows, so CustomerOrderItem.qty is DecimalString as usual. But
 * `GET /customer-orders/:id/shortage-preview` returns a *computed* result
 * built from `Number(...)` arithmetic inside
 * `customer-order-shortage.service.ts` — ShortageLine.neededQty/currentStock
 * are real JSON numbers, not strings. Double-check against the real service
 * method before assuming either convention for a new field here.
 */

export type CustomerOrderPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type CustomerOrderStatus = 'NEW' | 'IN_PRODUCTION' | 'COMPLETED' | 'CANCELLED';

/** One production batch (ProductionOrder) behind this line — a line can have several (План-графік §1). */
export interface ItemProductionBatch {
  id: string;
  unitsPlanned: number;
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
}

/** "Замовлено / У виробництві / Готово / Залишилось передати" (План-графік §1) — always derived server-side, never computed client-side from raw batches. */
export interface ItemQuantitySummary {
  ordered: number;
  inProduction: number;
  completed: number;
  remaining: number;
  batches: ItemProductionBatch[];
}

export interface CustomerOrderItem {
  id: string;
  companyId: string;
  customerOrderId: string;
  assemblyId: string;
  qty: DecimalString;
  /** Optional, only if it differs from the order's own — never auto-derived. */
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  itemDeadline: string | null;
  /** Present on findOne responses (not on query() list rows). */
  quantitySummary?: ItemQuantitySummary;
}

export interface CustomerOrder {
  id: string;
  companyId: string;
  orderNumber: string | null;
  clientName: string;
  contactPerson: string | null;
  deadline: string | null;
  priority: CustomerOrderPriority;
  status: CustomerOrderStatus;
  /** Planning targets for the order as a whole (План-графік §4) — optional, never auto-derived; null shows as "не заплановано". */
  plannedStartAt: string | null;
  plannedCompletionAt: string | null;
  plannedShipmentAt: string | null;
  plannedDeliveryAt: string | null;
  /** Extra costs entered directly by staff (not BOM-derived), counted into estimatedTotal/actualTotal on both list and detail views. */
  deliveryCost: DecimalString | null;
  transportRiggingCost: DecimalString | null;
  otherCost: DecimalString | null;
  comment: string | null;
  createdById: string;
  createdAt: string;
  /** Present on create/findOne responses; not on query() list rows. */
  items?: CustomerOrderItem[];
  /**
   * Present only on query() list rows (server-aggregated there since a
   * page of orders spans many different assemblies — see
   * CustomerOrdersService#withPriceTotals). The detail page computes the
   * same estimated/actual split itself, per line, from `items` instead.
   * null (not 0) means "no line has a determined price yet", not "free".
   */
  estimatedTotal?: number | null;
  actualTotal?: number | null;
  /**
   * "План виробництва" (2026-08-30) — present only on query() list rows.
   * Ready units (confirmed-by-execution FinishedGood, across every item's
   * top-level batches) / ordered qty, rounded, capped at 100. null when the
   * order has no items at all — shows as "—", not 0%.
   */
  percentComplete?: number | null;
}

export interface SubAssemblyToProduceInput {
  assemblyId: string;
  qty: number;
}

export interface CustomerOrderItemInput {
  assemblyId: string;
  qty: number;
  /** Optional, only if it differs from the order's own planned dates/deadline. */
  plannedStartAt?: string;
  plannedEndAt?: string;
  itemDeadline?: string;
  /** Sub-assemblies (recursively, at any BOM depth) the user marked "Виготовити" — recorded as intent only (CustomerOrderItem.plannedSubAssemblies), no batch is created here. */
  subAssembliesToProduce?: SubAssemblyToProduceInput[];
  /** Sub-assemblies the user marked "Зі складу" — claims IN_STOCK finished goods via SubAssemblyReservation, visible to later orders' own "Підвироби" dialog. */
  subAssembliesFromStock?: SubAssemblyToProduceInput[];
}

export interface CreateCustomerOrderInput {
  orderNumber?: string;
  clientName: string;
  contactPerson?: string;
  deadline?: string;
  priority?: CustomerOrderPriority;
  plannedStartAt?: string;
  plannedCompletionAt?: string;
  plannedShipmentAt?: string;
  plannedDeliveryAt?: string;
  deliveryCost?: number;
  transportRiggingCost?: number;
  otherCost?: number;
  comment?: string;
  items: CustomerOrderItemInput[];
}

/** Header-only — item lines are immutable once created; cancel and recreate for a genuine line change. */
export type UpdateCustomerOrderInput = Partial<Omit<CreateCustomerOrderInput, 'items'>>;

export interface QueryCustomerOrdersInput {
  status?: CustomerOrderStatus;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface PaginatedCustomerOrders {
  items: CustomerOrder[];
  total: number;
  limit: number;
  offset: number;
}

export function queryCustomerOrders(query: QueryCustomerOrdersInput = {}): Promise<PaginatedCustomerOrders> {
  return apiClient.get<PaginatedCustomerOrders>('customer-orders', { query: query as Record<string, string | number> });
}
export function getCustomerOrder(id: string): Promise<CustomerOrder> {
  return apiClient.get<CustomerOrder>(`customer-orders/${id}`);
}
export function createCustomerOrder(dto: CreateCustomerOrderInput): Promise<CustomerOrder> {
  return apiClient.post<CustomerOrder>('customer-orders', dto);
}
export function updateCustomerOrder(id: string, dto: UpdateCustomerOrderInput): Promise<CustomerOrder> {
  return apiClient.patch<CustomerOrder>(`customer-orders/${id}`, dto);
}
/** NEW or IN_PRODUCTION only — 400 otherwise. */
export function cancelCustomerOrder(id: string): Promise<CustomerOrder> {
  return apiClient.post<CustomerOrder>(`customer-orders/${id}/cancel`);
}
/** Manual staff action — no automatic "every line shipped" trigger exists (deliberate, see the real service's header comment). */
export function completeCustomerOrder(id: string): Promise<CustomerOrder> {
  return apiClient.post<CustomerOrder>(`customer-orders/${id}/complete`);
}
/** Permanent hard delete — admin-only (`customer-orders:delete`), cannot be undone. Use cancelCustomerOrder() for the reversible version. */
export function deleteCustomerOrder(id: string): Promise<{ ok: true }> {
  return apiClient.delete<{ ok: true }>(`customer-orders/${id}`);
}

export interface GiveItemToProductionInput {
  /** This batch's quantity. Defaults to the line's full remaining (not-yet-given) qty if omitted. */
  unitsPlanned?: number;
  /** Planned window for this specific batch — date AND time. */
  scheduledStartAt?: string;
  scheduledEndAt?: string;
}

export interface GiveToProductionResult {
  item: CustomerOrderItem;
  productionOrder: { id: string; [key: string]: unknown };
}

/** Creates a new batch (ProductionOrder) for this line — repeatable while quantity remains (План-графік §1); 400 once the line's full qty has been given across all batches. */
export function giveItemToProduction(
  orderId: string,
  itemId: string,
  dto: GiveItemToProductionInput = {},
): Promise<GiveToProductionResult> {
  return apiClient.post<GiveToProductionResult>(`customer-orders/${orderId}/items/${itemId}/give-to-production`, dto);
}

export interface GiveSubAssemblyToProductionInput {
  assemblyId: string;
  qty: number;
}

/** "Хід виробництва" per-node give-to-production — a sub-assembly at any BOM depth under this item, given to production on demand (replaces the old at-creation planning dialog). */
export function giveSubAssemblyToProduction(
  orderId: string,
  itemId: string,
  dto: GiveSubAssemblyToProductionInput,
): Promise<{ id: string; [key: string]: unknown }> {
  return apiClient.post<{ id: string; [key: string]: unknown }>(`customer-orders/${orderId}/items/${itemId}/sub-assembly-batches`, dto);
}
/** Calls giveItemToProduction for every not-yet-given line; already-given lines are silently skipped. */
export function giveAllToProduction(orderId: string): Promise<GiveToProductionResult[]> {
  return apiClient.post<GiveToProductionResult[]>(`customer-orders/${orderId}/give-all-to-production`);
}

/** "Хід виробництва" — one node of an order line's full BOM tree (виріб -> підвироби -> ...), each with its own IN_STOCK readiness and any already-planned batches. */
export interface ProductionTreeNode {
  assemblyId: string;
  name: string;
  article: string | null;
  qtyNeeded: number;
  qtyInStock: number;
  done: boolean;
  laborFundEstimate: number;
  batches: Array<{ id: string; status: string; unitsPlanned: number }>;
  /** Qty chosen for this node in the order-creation "Підвироби" dialog, if any — null when it wasn't marked "Виготовити" there. */
  planned: number | null;
  children: ProductionTreeNode[];
}

export function getItemProductionTree(orderId: string, itemId: string): Promise<ProductionTreeNode> {
  return apiClient.get<ProductionTreeNode>(`customer-orders/${orderId}/items/${itemId}/production-tree`);
}

/** "Фонд заробітної плати на все замовлення" — estimated (live BOM rates, every item's full tree incl. sub-assemblies) vs actual (frozen laborCostEur, started batches only). */
/** Mirrors PayrollArticleLine in lib/api-client/hr.ts — same shape, kept local per this file's own no-cross-import convention. */
export interface PayrollFundArticleLine {
  assemblyId: string | null;
  assemblyName: string | null;
  article: string | null;
  unitsProduced: number;
  amount: number;
}

export interface PayrollFundSummary {
  estimated: number;
  actual: number;
  /** "Скільки вже зароблено працівниками" — the real PayrollEntry (PIECEWORK) ledger for this order's batches, distinct from `actual` (the frozen laborCostEur estimate). */
  earnedActual: number;
  byArticle: PayrollFundArticleLine[];
}

export function getPayrollFundSummary(orderId: string): Promise<PayrollFundSummary> {
  return apiClient.get<PayrollFundSummary>(`customer-orders/${orderId}/payroll-fund`);
}

/** "План виробництва" → order detail page: one row per assembly actually seen in production for this order (any depth — top-level items AND sub-assembly batches). */
export interface OrderProductionUnitLine {
  assemblyId: string;
  assemblyName: string | null;
  article: string | null;
  qty: number;
}

export interface OrderProductionUnits {
  /** Manufactured, not yet confirmed by a worker (still "В роботі"). */
  inProgress: OrderProductionUnitLine[];
  /** Purchased outright, or manufactured and confirmed ("Що зроблено" / готово). */
  ready: OrderProductionUnitLine[];
}

export function getOrderProductionUnits(orderId: string): Promise<OrderProductionUnits> {
  return apiClient.get<OrderProductionUnits>(`customer-orders/${orderId}/production-units`);
}

export interface ShortageSupplierOption {
  supplierId: string;
  supplierName: string;
  price: number | null;
}

export interface ShortageLine {
  kind: 'PRODUCT' | 'ASSEMBLY';
  productId?: string;
  subAssemblyId?: string;
  description: string;
  /** Real JSON number — computed result, not a Prisma Decimal field. See file header. */
  neededQty: number;
  /** Real JSON number. Shown side-by-side with neededQty, never auto-subtracted ("no hidden arithmetic" rule) — the human decides the actual order qty. */
  currentStock: number;
  /** The resolved supplier's price for this line, null when unknown. See customer-order-shortage.service.ts's ShortageLine header comment. */
  price: number | null;
  /** Present only when the product/assembly has more than one linked supplier — see `ShortagePreview.ambiguousLines`. */
  supplierOptions?: ShortageSupplierOption[];
  /**
   * PRODUCT lines only (stock-reservation spec, simplified 2026-08-19):
   * "Заброньовано" — how much of `neededQty` is already reserved from
   * stock for this order, editable via `saveReservationDecisions` /
   * "Забронювати зі складу". Defaults to the maximum that was available at
   * order-creation time (auto-reserved with no manual decision needed).
   */
  reservedQty?: number;
  /** neededQty - reservedQty — the default "Кількість до замовлення" this line's PO qty should be pre-filled with. */
  qtyToPurchase?: number;
  /** Links a PurchaseOrderItem created from this line back to the requirement, so receiving it auto-reserves for this order. */
  sourceRequirementId?: string;
}

export interface SupplierGroup {
  supplierId: string | null;
  supplierName: string;
  lines: ShortageLine[];
}

export interface ShortagePreview {
  orderId: string;
  groups: SupplierGroup[];
  /** Lines whose product/assembly has more than one linked supplier — not placed in any group yet, since which one to order from is genuinely ambiguous until the human picks. */
  ambiguousLines: ShortageLine[];
}

/** Recursive, whole-order shortage analysis grouped by supplier. Never mutates anything. */
export function getShortagePreview(orderId: string): Promise<ShortagePreview> {
  return apiClient.get<ShortagePreview>(`customer-orders/${orderId}/shortage-preview`);
}

export interface ShortageGroupLineInput {
  kind: 'PRODUCT' | 'ASSEMBLY';
  productId?: string;
  subAssemblyId?: string;
  description: string;
  /** The actual qty to order — pre-filled from the preview's qtyToPurchase (neededQty minus what's already reserved) but human-editable before committing. */
  qty: number;
  /** Carried through from the preview so the created PurchaseOrderItem.expectedPrice is populated. Omitted when no price was known. */
  price?: number;
  /** Carried through from the preview's sourceRequirementId — links the created line back to this order's requirement so receiving it auto-reserves for this order. */
  sourceRequirementId?: string;
}

export interface PurchaseOrderGroupInput {
  /** Omitted/null = the "no supplier" bucket. */
  supplierId?: string;
  supplierName: string;
  items: ShortageGroupLineInput[];
}

/** Commits a (possibly hand-edited) preview — one PurchaseOrder per group, each with sourceCustomerOrderId set. */
export function createPurchaseOrdersFromShortage(
  orderId: string,
  groups: PurchaseOrderGroupInput[],
): Promise<unknown[]> {
  return apiClient.post<unknown[]>(`customer-orders/${orderId}/purchase-orders-from-shortage`, { groups });
}

export interface SaveReservationDecisionInput {
  productId: string;
  qtyFromStock: number;
}

/** "Забронювати зі складу" — batch-adjust this order's stock-reserved qty for one or more products. May 409 if a line's full requested increase isn't actually available. */
export function saveReservationDecisions(orderId: string, decisions: SaveReservationDecisionInput[]): Promise<unknown[]> {
  return apiClient.post<unknown[]>(`customer-orders/${orderId}/reservations`, { decisions });
}

export type ShipmentStatus = 'SHIPPED' | 'DELIVERED';

export interface ShipmentItem {
  id: string;
  companyId: string;
  shipmentId: string;
  finishedGoodId: string;
}

export interface Shipment {
  id: string;
  companyId: string;
  carrier: string | null;
  waybillNumber: string | null;
  packageCount: number | null;
  weightKg: DecimalString | null;
  dimensions: string | null;
  status: ShipmentStatus;
  customerOrderId: string | null;
  comment: string | null;
  createdById: string;
  shipDate: string | null;
  deliveryDate: string | null;
  createdAt: string;
  /** Present on create/findOne responses; not on query() list rows. */
  items?: ShipmentItem[];
}

export interface CreateShipmentInput {
  customerOrderId?: string;
  carrier?: string;
  waybillNumber?: string;
  packageCount?: number;
  weightKg?: number;
  dimensions?: string;
  comment?: string;
  /** Each must currently be IN_STOCK — flipped to SHIPPED as part of this call. */
  finishedGoodIds: string[];
}

export interface QueryShipmentsInput {
  status?: ShipmentStatus;
  customerOrderId?: string;
  limit?: number;
  offset?: number;
}

export interface PaginatedShipments {
  items: Shipment[];
  total: number;
  limit: number;
  offset: number;
}

export function queryShipments(query: QueryShipmentsInput = {}): Promise<PaginatedShipments> {
  return apiClient.get<PaginatedShipments>('shipments', { query: query as Record<string, string | number> });
}
export function getShipment(id: string): Promise<Shipment> {
  return apiClient.get<Shipment>(`shipments/${id}`);
}
export function createShipment(dto: CreateShipmentInput): Promise<Shipment> {
  return apiClient.post<Shipment>('shipments', dto);
}
export function markShipmentDelivered(id: string): Promise<Shipment> {
  return apiClient.post<Shipment>(`shipments/${id}/deliver`);
}
/** Not-yet-delivered shipments only — reverts the consumed finished goods back to IN_STOCK. */
export function deleteShipment(id: string): Promise<{ ok: true }> {
  return apiClient.delete<{ ok: true }>(`shipments/${id}`);
}
