import { apiClient } from './http';
import type { DecimalString } from './decimal';

/**
 * Typed wrappers for backend/src/modules/production/ (ProductionOrdersController,
 * ProductionStagesController, FinishedGoodsController, QcController,
 * QcChecklistController). Field shapes copied verbatim from
 * dto/production-order.dto.ts, dto/production-stage.dto.ts,
 * dto/finished-goods.dto.ts, dto/qc-check.dto.ts, dto/qc-checklist-item.dto.ts,
 * and schema.prisma's ProductionOrder/ProductionOrderWorker/
 * ProductionOrderPickListItem/ProductionOrderStageEvent/FinishedGood/
 * ProductionStage/QcChecklistItem/QcCheck/QcCheckResult models.
 *
 * Every field below from a plain CRUD/findOne/query endpoint is a Prisma
 * row, so Decimal fields are DecimalString as usual — unlike BOM, this
 * module has no computed-result endpoint that returns plain numbers (the
 * `start()` response is still a plain `findOne()` re-fetch, per
 * production-orders.service.ts's last line).
 */

export type ProductionOrderStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type FinishedGoodStatus = 'IN_STOCK' | 'SHIPPED' | 'CONSUMED' | 'REWORK' | 'DEFECTIVE';
export type QcResult = 'ACCEPTED' | 'REWORK';

export interface ProductionOrderWorker {
  id: string;
  companyId: string;
  productionOrderId: string;
  employeeId: string;
  percent: DecimalString;
}

export interface ProductionOrderPickListItem {
  id: string;
  companyId: string;
  productionOrderId: string;
  productId: string | null;
  description: string;
  qty: DecimalString;
  unitPriceEur: DecimalString | null;
  lineTotalEur: DecimalString | null;
  consumedFinishedGoodIds: string[];
}

export interface ProductionOrderStageEvent {
  id: string;
  companyId: string;
  productionOrderId: string;
  stageIndex: number;
  actorUserId: string;
  createdAt: string;
}

export interface FinishedGood {
  id: string;
  companyId: string;
  serialNumber: string;
  assemblyId: string;
  productionOrderId: string;
  status: FinishedGoodStatus;
  customerOrderId: string | null;
  comment: string | null;
  unitCostLocalEur: DecimalString;
  unitCostGermanEur: DecimalString;
  consumedInProductionOrderId: string | null;
  manufactureDate: string;
}

export interface ProductionOrder {
  id: string;
  companyId: string;
  assemblyId: string;
  assemblyVersionId: string | null;
  unitsPlanned: DecimalString;
  status: ProductionOrderStatus;
  createdById: string;
  comment: string | null;
  currentStageIndex: number | null;
  /** Optional target window for the schedule view — a plan, never frozen like the cost fields below. */
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  totalLocalCostEur: DecimalString | null;
  totalGermanCostEur: DecimalString | null;
  laborCostEur: DecimalString | null;
  packagingCostEur: DecimalString | null;
  deliveryCostEur: DecimalString | null;
  otherCostEur: DecimalString | null;
  fullCostEur: DecimalString | null;
  createdAt: string;
  completedAt: string | null;
  /** Only present on findOne (create/query rows don't include these). */
  workers?: ProductionOrderWorker[];
  pickListItems?: ProductionOrderPickListItem[];
  stageEvents?: ProductionOrderStageEvent[];
  finishedGoods?: FinishedGood[];
}

export interface ProductionOrderWorkerInput {
  employeeId: string;
  /** Share of labor cost; normalized to sum to 100 across all workers at start() time — does not need to already sum to 100. */
  percent: number;
}

export interface CreateProductionOrderInput {
  assemblyId: string;
  unitsPlanned: number;
  comment?: string;
  workers?: ProductionOrderWorkerInput[];
  /** Optional target window for the schedule view — ISO date/datetime strings, purely a plan, never frozen. */
  scheduledStartAt?: string;
  scheduledEndAt?: string;
}

export interface QueryProductionOrdersInput {
  status?: ProductionOrderStatus;
  assemblyId?: string;
  limit?: number;
  offset?: number;
}

export interface PaginatedProductionOrders {
  items: ProductionOrder[];
  total: number;
  limit: number;
  offset: number;
}

export function queryProductionOrders(query: QueryProductionOrdersInput = {}): Promise<PaginatedProductionOrders> {
  return apiClient.get<PaginatedProductionOrders>('production-orders', { query: query as Record<string, string | number> });
}
export function getProductionOrder(id: string): Promise<ProductionOrder> {
  return apiClient.get<ProductionOrder>(`production-orders/${id}`);
}
export function createProductionOrder(dto: CreateProductionOrderInput): Promise<ProductionOrder> {
  return apiClient.post<ProductionOrder>('production-orders', dto);
}
/** PLANNED orders only — 400 otherwise. */
export function setProductionOrderWorkers(id: string, workers: ProductionOrderWorkerInput[]): Promise<ProductionOrder> {
  return apiClient.put<ProductionOrder>(`production-orders/${id}/workers`, { workers });
}
/** PLANNED orders only — 400 otherwise. */
export function cancelProductionOrder(id: string): Promise<ProductionOrder> {
  return apiClient.post<ProductionOrder>(`production-orders/${id}/cancel`);
}

export interface StartProductionOrderInput {
  warehouseId?: string;
}

/** Shape of the `shortages` array on a start() 400 body (production-orders.service.ts's `ShortageLine`) — ASSEMBLY-kind entries mean the required sub-assembly hasn't been produced yet (checked as `FinishedGood` rows with status IN_STOCK, not just "is it composable"), not a raw-material stock issue. */
export interface ProductionShortageLine {
  kind: 'PRODUCT' | 'ASSEMBLY';
  productId?: string;
  subAssemblyId?: string;
  needed: number;
  available: number;
}

/**
 * Checks availability, consumes components (raw products from stock,
 * sub-assemblies via FIFO-consumed FinishedGoods), generates one
 * FinishedGood per planned unit, freezes cost, splits piecework pay, and
 * enters stage tracking (or completes immediately with 0 configured
 * stages). Throws an ApiError whose body has a structured
 * `shortages: ProductionShortageLine[]` on insufficient stock — same
 * pattern as BOM's produce().
 */
export function startProductionOrder(id: string, dto: StartProductionOrderInput = {}): Promise<ProductionOrder> {
  return apiClient.post<ProductionOrder>(`production-orders/${id}/start`, dto);
}
/** IN_PROGRESS orders with an active stage only. Auto-completes on the last configured stage. */
export function advanceProductionOrderStage(id: string): Promise<ProductionOrder> {
  return apiClient.post<ProductionOrder>(`production-orders/${id}/advance-stage`);
}

export interface ProductionStage {
  id: string;
  companyId: string;
  name: string;
  sortOrder: number;
}

export function listProductionStages(): Promise<ProductionStage[]> {
  return apiClient.get<ProductionStage[]>('production-stages');
}
export function createProductionStage(name: string): Promise<ProductionStage> {
  return apiClient.post<ProductionStage>('production-stages', { name });
}
export function reorderProductionStages(orderedIds: string[]): Promise<ProductionStage[]> {
  return apiClient.put<ProductionStage[]>('production-stages/reorder', { orderedIds });
}
export function deleteProductionStage(id: string): Promise<{ ok: true }> {
  return apiClient.delete<{ ok: true }>(`production-stages/${id}`);
}

export interface QueryFinishedGoodsInput {
  assemblyId?: string;
  status?: FinishedGoodStatus;
  limit?: number;
  offset?: number;
}

export interface PaginatedFinishedGoods {
  items: FinishedGood[];
  total: number;
  limit: number;
  offset: number;
}

export function queryFinishedGoods(query: QueryFinishedGoodsInput = {}): Promise<PaginatedFinishedGoods> {
  return apiClient.get<PaginatedFinishedGoods>('finished-goods', { query: query as Record<string, string | number> });
}
export function getFinishedGood(id: string): Promise<FinishedGood> {
  return apiClient.get<FinishedGood>(`finished-goods/${id}`);
}

export interface QcChecklistItem {
  id: string;
  companyId: string;
  name: string;
  sortOrder: number;
}

export function listQcChecklistItems(): Promise<QcChecklistItem[]> {
  return apiClient.get<QcChecklistItem[]>('qc-checklist-items');
}
export function createQcChecklistItem(name: string): Promise<QcChecklistItem> {
  return apiClient.post<QcChecklistItem>('qc-checklist-items', { name });
}
export function deleteQcChecklistItem(id: string): Promise<{ ok: true }> {
  return apiClient.delete<{ ok: true }>(`qc-checklist-items/${id}`);
}

export interface QcCheckResultLine {
  itemName: string;
  passed: boolean;
}

export interface QcCheck {
  id: string;
  companyId: string;
  finishedGoodId: string;
  result: QcResult;
  inspectorId: string;
  comment: string | null;
  checkedAt: string;
  results?: QcCheckResultLine[];
}

export interface RecordQcCheckInput {
  finishedGoodId: string;
  result: QcResult;
  comment?: string;
  results?: QcCheckResultLine[];
}

/** Flips the finished good's status: ACCEPTED → IN_STOCK, REWORK → REWORK. */
export function recordQcCheck(dto: RecordQcCheckInput): Promise<QcCheck> {
  return apiClient.post<QcCheck>('qc-checks', dto);
}
export function getQcChecksForFinishedGood(finishedGoodId: string): Promise<QcCheck[]> {
  return apiClient.get<QcCheck[]>(`qc-checks/finished-good/${finishedGoodId}`);
}

// ---- Production schedule (year view: real orders + forward-planning slots) ----

export interface ProductionScheduleSlot {
  id: string;
  companyId: string;
  assemblyId: string | null;
  title: string;
  plannedUnits: DecimalString | null;
  startAt: string;
  endAt: string;
  comment: string | null;
  convertedToProductionOrderId: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductionScheduleSlotInput {
  assemblyId?: string;
  title: string;
  plannedUnits?: number;
  startAt: string;
  endAt: string;
  comment?: string;
}

export type UpdateProductionScheduleSlotInput = Partial<CreateProductionScheduleSlotInput>;

export function createProductionScheduleSlot(dto: CreateProductionScheduleSlotInput): Promise<ProductionScheduleSlot> {
  return apiClient.post<ProductionScheduleSlot>('production-schedule-slots', dto);
}
export function updateProductionScheduleSlot(id: string, dto: UpdateProductionScheduleSlotInput): Promise<ProductionScheduleSlot> {
  return apiClient.patch<ProductionScheduleSlot>(`production-schedule-slots/${id}`, dto);
}
export function deleteProductionScheduleSlot(id: string): Promise<{ id: string; deleted: true }> {
  return apiClient.delete<{ id: string; deleted: true }>(`production-schedule-slots/${id}`);
}
/** Creates a real ProductionOrder from this slot (via the normal create() path) — requires assemblyId/plannedUnits to already be set. */
export function convertProductionScheduleSlot(id: string): Promise<{ slot: ProductionScheduleSlot; productionOrder: ProductionOrder }> {
  return apiClient.post<{ slot: ProductionScheduleSlot; productionOrder: ProductionOrder }>(`production-schedule-slots/${id}/convert`, {});
}

export interface ScheduledOrderLine {
  id: string;
  assemblyName: string;
  status: ProductionOrderStatus;
  scheduledStartAt: string;
  scheduledEndAt: string;
  unitsPlanned: number;
}

export interface ScheduleSlotLine {
  id: string;
  assemblyId: string | null;
  assemblyName: string | null;
  title: string;
  startAt: string;
  endAt: string;
  plannedUnits: number | null;
}

export interface ProductionScheduleQuery {
  /** ISO date. Defaults to Jan 1 of the current year. */
  from?: string;
  /** ISO date. Defaults to Dec 31 of the current year. */
  to?: string;
}

/** Unified year-schedule view: real orders (visualized) + not-yet-converted planning slots. */
export function getProductionSchedule(query: ProductionScheduleQuery = {}): Promise<{ orders: ScheduledOrderLine[]; slots: ScheduleSlotLine[] }> {
  return apiClient.get<{ orders: ScheduledOrderLine[]; slots: ScheduleSlotLine[] }>('production-schedule', { query: query as Record<string, string> });
}
