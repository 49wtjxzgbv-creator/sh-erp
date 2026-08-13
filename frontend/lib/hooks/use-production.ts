'use client';

import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  queryProductionOrders,
  getProductionOrder,
  createProductionOrder,
  setProductionOrderWorkers,
  cancelProductionOrder,
  startProductionOrder,
  advanceProductionOrderStage,
  listProductionStages,
  createProductionStage,
  reorderProductionStages,
  deleteProductionStage,
  queryFinishedGoods,
  getFinishedGood,
  listQcChecklistItems,
  createQcChecklistItem,
  deleteQcChecklistItem,
  recordQcCheck,
  getQcChecksForFinishedGood,
  type QueryProductionOrdersInput,
  type CreateProductionOrderInput,
  type ProductionOrderWorkerInput,
  type StartProductionOrderInput,
  type QueryFinishedGoodsInput,
  type RecordQcCheckInput,
} from '@/lib/api-client/production';

const ordersKey = (query: QueryProductionOrdersInput) => ['production-orders', query] as const;
const orderKey = (id: string) => ['production-orders', id] as const;
const stagesKey = ['production-stages'] as const;
const finishedGoodsKey = (query: QueryFinishedGoodsInput) => ['finished-goods', query] as const;
const finishedGoodKey = (id: string) => ['finished-goods', id] as const;
const checklistKey = ['qc-checklist-items'] as const;
const qcChecksKey = (finishedGoodId: string) => ['qc-checks', 'finished-good', finishedGoodId] as const;

export function useProductionOrders(query: QueryProductionOrdersInput) {
  return useQuery({ queryKey: ordersKey(query), queryFn: () => queryProductionOrders(query) });
}

export function useProductionOrder(id: string | undefined) {
  return useQuery({
    queryKey: orderKey(id ?? ''),
    queryFn: () => getProductionOrder(id as string),
    enabled: Boolean(id),
  });
}

/** Same cache entries as `useProductionOrder` (shares `orderKey`), batched via `useQueries` — e.g. resolving each customer-order line's linked production order to read its frozen `totalLocalCostEur` for an "actual price" readout. */
export function useProductionOrdersByIds(ids: (string | undefined)[]) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: orderKey(id ?? ''),
      queryFn: () => getProductionOrder(id as string),
      enabled: Boolean(id),
    })),
  });
}

export function useCreateProductionOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateProductionOrderInput) => createProductionOrder(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['production-orders'] }),
  });
}

export function useSetProductionOrderWorkers(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (workers: ProductionOrderWorkerInput[]) => setProductionOrderWorkers(id, workers),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production-orders'] });
      qc.invalidateQueries({ queryKey: orderKey(id) });
    },
  });
}

export function useCancelProductionOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => cancelProductionOrder(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production-orders'] });
      qc.invalidateQueries({ queryKey: orderKey(id) });
    },
  });
}

export function useStartProductionOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: StartProductionOrderInput = {}) => startProductionOrder(id, dto),
    onSuccess: () => {
      // Consumes stock and (possibly) sub-assembly FinishedGoods — every
      // stock/finished-goods view elsewhere is now stale too.
      qc.invalidateQueries({ queryKey: ['production-orders'] });
      qc.invalidateQueries({ queryKey: orderKey(id) });
      qc.invalidateQueries({ queryKey: ['stock-levels'] });
      qc.invalidateQueries({ queryKey: ['stock-history'] });
      qc.invalidateQueries({ queryKey: ['finished-goods'] });
    },
  });
}

export function useAdvanceProductionOrderStage(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => advanceProductionOrderStage(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production-orders'] });
      qc.invalidateQueries({ queryKey: orderKey(id) });
    },
  });
}

export function useProductionStages() {
  return useQuery({ queryKey: stagesKey, queryFn: () => listProductionStages() });
}

export function useCreateProductionStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => createProductionStage(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: stagesKey }),
  });
}

export function useReorderProductionStages() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderedIds: string[]) => reorderProductionStages(orderedIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: stagesKey }),
  });
}

export function useDeleteProductionStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteProductionStage(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: stagesKey }),
  });
}

export function useFinishedGoods(query: QueryFinishedGoodsInput) {
  return useQuery({ queryKey: finishedGoodsKey(query), queryFn: () => queryFinishedGoods(query) });
}

export function useFinishedGood(id: string | undefined) {
  return useQuery({
    queryKey: finishedGoodKey(id ?? ''),
    queryFn: () => getFinishedGood(id as string),
    enabled: Boolean(id),
  });
}

export function useQcChecklistItems() {
  return useQuery({ queryKey: checklistKey, queryFn: () => listQcChecklistItems() });
}

export function useCreateQcChecklistItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => createQcChecklistItem(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: checklistKey }),
  });
}

export function useDeleteQcChecklistItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteQcChecklistItem(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: checklistKey }),
  });
}

export function useQcChecksForFinishedGood(finishedGoodId: string | undefined) {
  return useQuery({
    queryKey: qcChecksKey(finishedGoodId ?? ''),
    queryFn: () => getQcChecksForFinishedGood(finishedGoodId as string),
    enabled: Boolean(finishedGoodId),
  });
}

export function useRecordQcCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: RecordQcCheckInput) => recordQcCheck(dto),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['finished-goods'] });
      qc.invalidateQueries({ queryKey: finishedGoodKey(result.finishedGoodId) });
      qc.invalidateQueries({ queryKey: qcChecksKey(result.finishedGoodId) });
    },
  });
}
