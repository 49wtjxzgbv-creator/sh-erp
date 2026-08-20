'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listWarehouses,
  createWarehouse,
  updateWarehouse,
  deleteWarehouse,
  getStockLevels,
  getStockHistory,
  getStockReservationBreakdown,
  getStockShortageBreakdown,
  recordStockMovement,
  moveStock,
  listInventorySessions,
  startInventorySession,
  getInventorySessionItems,
  recordInventoryCount,
  completeInventorySession,
  type CreateWarehouseInput,
  type UpdateWarehouseInput,
  type QueryStockInput,
  type QueryStockHistoryInput,
  type RecordStockMovementInput,
  type MoveStockInput,
  type StartInventorySessionInput,
  type RecordInventoryCountInput,
} from '@/lib/api-client/inventory';

const warehousesKey = ['warehouses'] as const;
const stockLevelsKey = (q: QueryStockInput) => ['stock-levels', q] as const;
const stockHistoryKey = (q: QueryStockHistoryInput) => ['stock-history', q] as const;
const stockReservationsKey = (productId: string, warehouseId: string) => ['stock-reservations', productId, warehouseId] as const;
const stockShortageKey = (productId: string, warehouseId: string) => ['stock-shortage', productId, warehouseId] as const;
const sessionsKey = ['inventory-sessions'] as const;
const sessionItemsKey = (id: string) => ['inventory-sessions', id, 'items'] as const;

export function useWarehouses() {
  return useQuery({ queryKey: warehousesKey, queryFn: () => listWarehouses() });
}

export function useCreateWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateWarehouseInput) => createWarehouse(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: warehousesKey }),
  });
}

export function useUpdateWarehouse(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateWarehouseInput) => updateWarehouse(id, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: warehousesKey }),
  });
}

export function useDeleteWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteWarehouse(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: warehousesKey }),
  });
}

export function useStockLevels(query: QueryStockInput) {
  return useQuery({ queryKey: stockLevelsKey(query), queryFn: () => getStockLevels(query) });
}

/** §17 drill-down — only fetched while the popover for a given cell is actually open (see `enabled`). */
export function useStockReservationBreakdown(productId: string | undefined, warehouseId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: stockReservationsKey(productId ?? '', warehouseId ?? ''),
    queryFn: () => getStockReservationBreakdown(productId as string, warehouseId as string),
    enabled: Boolean(productId && warehouseId && enabled),
  });
}

/** Click-through for the RED "Не вистачає для резервації" number — same lazy-fetch-on-open pattern as the reservation drill-down above. */
export function useStockShortageBreakdown(productId: string | undefined, warehouseId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: stockShortageKey(productId ?? '', warehouseId ?? ''),
    queryFn: () => getStockShortageBreakdown(productId as string, warehouseId as string),
    enabled: Boolean(productId && warehouseId && enabled),
  });
}

export function useStockHistory(query: QueryStockHistoryInput) {
  return useQuery({ queryKey: stockHistoryKey(query), queryFn: () => getStockHistory(query) });
}

/** Invalidates both levels and history — every stock-changing mutation affects both views. */
function invalidateStockQueries(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['stock-levels'] });
  qc.invalidateQueries({ queryKey: ['stock-history'] });
}

export function useRecordStockMovement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: RecordStockMovementInput) => recordStockMovement(dto),
    onSuccess: () => invalidateStockQueries(qc),
  });
}

export function useMoveStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: MoveStockInput) => moveStock(dto),
    onSuccess: () => invalidateStockQueries(qc),
  });
}

export function useInventorySessions() {
  return useQuery({ queryKey: sessionsKey, queryFn: () => listInventorySessions() });
}

export function useStartInventorySession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: StartInventorySessionInput) => startInventorySession(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: sessionsKey }),
  });
}

export function useInventorySessionItems(sessionId: string | undefined) {
  return useQuery({
    queryKey: sessionItemsKey(sessionId ?? ''),
    queryFn: () => getInventorySessionItems(sessionId as string),
    enabled: Boolean(sessionId),
  });
}

export function useRecordInventoryCount(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: RecordInventoryCountInput) => recordInventoryCount(sessionId, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: sessionItemsKey(sessionId) }),
  });
}

export function useCompleteInventorySession(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => completeInventorySession(sessionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: sessionsKey });
      qc.invalidateQueries({ queryKey: sessionItemsKey(sessionId) });
      invalidateStockQueries(qc);
    },
  });
}
