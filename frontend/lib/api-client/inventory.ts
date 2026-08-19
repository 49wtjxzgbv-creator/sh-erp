import { apiClient } from './http';
import type { DecimalString } from './decimal';

/**
 * Typed wrappers for backend/src/modules/inventory/ (WarehousesController,
 * StockController, InventorySessionsController). Field shapes copied
 * verbatim from dto/warehouse.dto.ts, dto/stock-movement.dto.ts,
 * dto/inventory-session.dto.ts, and schema.prisma's Warehouse/
 * WarehouseStock/StockMovement/InventorySession/InventoryItem models.
 */

export interface Warehouse {
  id: string;
  companyId: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateWarehouseInput {
  name: string;
  isDefault?: boolean;
}
export type UpdateWarehouseInput = Partial<CreateWarehouseInput>;

export function listWarehouses(): Promise<Warehouse[]> {
  return apiClient.get<Warehouse[]>('warehouses');
}
export function getWarehouse(id: string): Promise<Warehouse> {
  return apiClient.get<Warehouse>(`warehouses/${id}`);
}
export function createWarehouse(dto: CreateWarehouseInput): Promise<Warehouse> {
  return apiClient.post<Warehouse>('warehouses', dto);
}
export function updateWarehouse(id: string, dto: UpdateWarehouseInput): Promise<Warehouse> {
  return apiClient.patch<Warehouse>(`warehouses/${id}`, dto);
}
export function deleteWarehouse(id: string): Promise<Warehouse> {
  return apiClient.delete<Warehouse>(`warehouses/${id}`);
}

/** Matches the backend's StockMovementType enum exactly (schema.prisma). MOVE/ASSEMBLY_CONSUMPTION/PRODUCTION_CONSUMPTION/INVENTORY_RECONCILIATION are only ever posted by the backend itself (move(), BOM/Production consumption, inventory-session completion) — never selectable in the single-warehouse "record movement" form, which only offers RecordStockMovementDto's own SINGLE_WAREHOUSE_MOVEMENT_TYPES subset. */
export type StockMovementType =
  | 'RECEIVE'
  | 'ISSUE'
  | 'ADJUST'
  | 'MOVE'
  | 'DEFECT_WRITE_OFF'
  | 'ASSEMBLY_CONSUMPTION'
  | 'PRODUCTION_CONSUMPTION'
  | 'INVENTORY_RECONCILIATION';

export type SingleWarehouseMovementType = 'RECEIVE' | 'ISSUE' | 'ADJUST' | 'DEFECT_WRITE_OFF';

export interface RecordStockMovementInput {
  productId: string;
  warehouseId: string;
  type: SingleWarehouseMovementType;
  qtyDelta: number;
  comment?: string;
}

export interface MoveStockInput {
  productId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  qty: number;
  comment?: string;
}

export interface StockMovement {
  id: string;
  companyId: string;
  productId: string;
  warehouseId: string | null;
  type: StockMovementType;
  qtyDelta: DecimalString;
  qtyAfter: DecimalString;
  comment: string | null;
  actorUserId: string | null;
  sourceType: string | null;
  sourceId: string | null;
  createdAt: string;
}

export interface WarehouseStock {
  id: string;
  companyId: string;
  productId: string;
  warehouseId: string;
  qty: DecimalString;
  /** Stock-reservation spec §4/§17: denormalized running total of every ACTIVE reservation against this (product, warehouse) — see StockReservation. */
  reservedQty: DecimalString;
  /** Computed server-side as qty - reservedQty, always present alongside the two above (StockService#getLevels). */
  availableQty: DecimalString;
  /** "Не вистачає для резервації" — company-wide sum of every active order's outstanding need for this product, attached only on the actual default-warehouse row (zero elsewhere). */
  globalShortageQty: DecimalString;
  createdAt: string;
  updatedAt: string;
}

export type StockReservationSource = 'STOCK' | 'PURCHASE';

/** §17 drill-down line: one order's share of a (product, warehouse) cell's "Зарезервовано" total. */
export interface StockReservationBreakdownLine {
  customerOrderId: string;
  customerOrderItemId: string;
  orderNumber: string | null;
  clientName: string;
  source: StockReservationSource;
  qty: number;
}

export function getStockReservationBreakdown(productId: string, warehouseId: string): Promise<StockReservationBreakdownLine[]> {
  return apiClient.get<StockReservationBreakdownLine[]>('stock/reservations', { query: { productId, warehouseId } });
}

export interface QueryStockInput {
  productId?: string;
  warehouseId?: string;
}

export interface QueryStockHistoryInput extends QueryStockInput {
  limit?: number;
  offset?: number;
}

export interface PaginatedStockMovements {
  items: StockMovement[];
  total: number;
  limit: number;
  offset: number;
}

export function recordStockMovement(dto: RecordStockMovementInput): Promise<StockMovement> {
  return apiClient.post<StockMovement>('stock/movements', dto);
}

export function moveStock(dto: MoveStockInput): Promise<{ correlationId: string; out: StockMovement; in: StockMovement }> {
  return apiClient.post('stock/move', dto);
}

export function getStockLevels(query: QueryStockInput = {}): Promise<WarehouseStock[]> {
  return apiClient.get<WarehouseStock[]>('stock/levels', { query: query as Record<string, string> });
}

export function getStockHistory(query: QueryStockHistoryInput = {}): Promise<PaginatedStockMovements> {
  return apiClient.get<PaginatedStockMovements>('stock/movements', { query: query as Record<string, string | number> });
}

export type InventorySessionStatus = 'IN_PROGRESS' | 'COMPLETED';

export interface InventorySession {
  id: string;
  companyId: string;
  name: string;
  status: InventorySessionStatus;
  startedById: string;
  comment: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface InventoryItem {
  id: string;
  companyId: string;
  inventorySessionId: string;
  productId: string;
  expectedQty: DecimalString;
  actualQty: DecimalString | null;
  counted: boolean;
}

export interface StartInventorySessionInput {
  name: string;
  comment?: string;
}

export interface RecordInventoryCountInput {
  productId: string;
  actualQty: number;
}

export function listInventorySessions(): Promise<InventorySession[]> {
  return apiClient.get<InventorySession[]>('inventory-sessions');
}

export function startInventorySession(dto: StartInventorySessionInput): Promise<InventorySession> {
  return apiClient.post<InventorySession>('inventory-sessions', dto);
}

export function getInventorySessionItems(sessionId: string): Promise<InventoryItem[]> {
  return apiClient.get<InventoryItem[]>(`inventory-sessions/${sessionId}/items`);
}

export function recordInventoryCount(sessionId: string, dto: RecordInventoryCountInput): Promise<InventoryItem> {
  return apiClient.post<InventoryItem>(`inventory-sessions/${sessionId}/counts`, dto);
}

export function completeInventorySession(
  sessionId: string,
): Promise<{ session: InventorySession; discrepanciesReconciled: number }> {
  return apiClient.post(`inventory-sessions/${sessionId}/complete`);
}
