'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  queryCustomerOrders,
  getCustomerOrder,
  createCustomerOrder,
  updateCustomerOrder,
  cancelCustomerOrder,
  completeCustomerOrder,
  deleteCustomerOrder,
  giveItemToProduction,
  getItemProductionTree,
  giveAllToProduction,
  getShortagePreview,
  createPurchaseOrdersFromShortage,
  saveReservationDecisions,
  queryShipments,
  getShipment,
  createShipment,
  markShipmentDelivered,
  deleteShipment,
  type QueryCustomerOrdersInput,
  type CreateCustomerOrderInput,
  type UpdateCustomerOrderInput,
  type GiveItemToProductionInput,
  type PurchaseOrderGroupInput,
  type SaveReservationDecisionInput,
  type QueryShipmentsInput,
  type CreateShipmentInput,
} from '@/lib/api-client/sales';

const customerOrdersKey = (query: QueryCustomerOrdersInput) => ['customer-orders', query] as const;
const customerOrderKey = (id: string) => ['customer-orders', id] as const;
const shortagePreviewKey = (id: string) => ['customer-orders', id, 'shortage-preview'] as const;
const shipmentsKey = (query: QueryShipmentsInput) => ['shipments', query] as const;
const shipmentKey = (id: string) => ['shipments', id] as const;

export function useCustomerOrders(query: QueryCustomerOrdersInput) {
  return useQuery({ queryKey: customerOrdersKey(query), queryFn: () => queryCustomerOrders(query) });
}

export function useCustomerOrder(id: string | undefined) {
  return useQuery({
    queryKey: customerOrderKey(id ?? ''),
    queryFn: () => getCustomerOrder(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateCustomerOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateCustomerOrderInput) => createCustomerOrder(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customer-orders'] }),
  });
}

export function useUpdateCustomerOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateCustomerOrderInput) => updateCustomerOrder(id, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer-orders'] });
      qc.invalidateQueries({ queryKey: customerOrderKey(id) });
    },
  });
}

export function useCancelCustomerOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => cancelCustomerOrder(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer-orders'] });
      qc.invalidateQueries({ queryKey: customerOrderKey(id) });
    },
  });
}

export function useCompleteCustomerOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => completeCustomerOrder(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer-orders'] });
      qc.invalidateQueries({ queryKey: customerOrderKey(id) });
    },
  });
}

/** Permanent hard delete — admin-only, cannot be undone. See useCancelCustomerOrder for the reversible version. */
export function useDeleteCustomerOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteCustomerOrder(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customer-orders'] }),
  });
}

export function useGiveItemToProduction(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, dto }: { itemId: string; dto?: GiveItemToProductionInput }) =>
      giveItemToProduction(orderId, itemId, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer-orders'] });
      qc.invalidateQueries({ queryKey: customerOrderKey(orderId) });
      qc.invalidateQueries({ queryKey: ['production-orders'] });
    },
  });
}

/** Invalidated by the same broad ['production-orders']/order-detail keys useGiveItemToProduction already invalidates, so "give to production"/"revert start" elsewhere in the app keep this tree fresh automatically. */
export function useItemProductionTree(orderId: string, itemId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['customer-orders', orderId, 'items', itemId ?? '', 'production-tree'] as const,
    queryFn: () => getItemProductionTree(orderId, itemId as string),
    enabled: enabled && Boolean(itemId),
  });
}

export function useGiveAllToProduction(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => giveAllToProduction(orderId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer-orders'] });
      qc.invalidateQueries({ queryKey: customerOrderKey(orderId) });
      qc.invalidateQueries({ queryKey: ['production-orders'] });
    },
  });
}

export function useShortagePreview(orderId: string | undefined) {
  return useQuery({
    queryKey: shortagePreviewKey(orderId ?? ''),
    queryFn: () => getShortagePreview(orderId as string),
    enabled: Boolean(orderId),
  });
}

export function useCreatePurchaseOrdersFromShortage(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (groups: PurchaseOrderGroupInput[]) => createPurchaseOrdersFromShortage(orderId, groups),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['purchase-orders'] }),
  });
}

/** "Забронювати зі складу" — may 409 if a line's full requested increase isn't actually available (§16). */
export function useSaveReservationDecisions(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (decisions: SaveReservationDecisionInput[]) => saveReservationDecisions(orderId, decisions),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: shortagePreviewKey(orderId) });
      qc.invalidateQueries({ queryKey: ['stock-levels'] });
      qc.invalidateQueries({ queryKey: ['stock-reservations'] });
    },
  });
}

export function useShipments(query: QueryShipmentsInput) {
  return useQuery({ queryKey: shipmentsKey(query), queryFn: () => queryShipments(query) });
}

export function useShipment(id: string | undefined) {
  return useQuery({
    queryKey: shipmentKey(id ?? ''),
    queryFn: () => getShipment(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateShipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateShipmentInput) => createShipment(dto),
    onSuccess: () => {
      // Shipping flips FinishedGood.status IN_STOCK -> SHIPPED — finished-goods views go stale too.
      qc.invalidateQueries({ queryKey: ['shipments'] });
      qc.invalidateQueries({ queryKey: ['finished-goods'] });
    },
  });
}

export function useMarkShipmentDelivered(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => markShipmentDelivered(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shipments'] });
      qc.invalidateQueries({ queryKey: shipmentKey(id) });
    },
  });
}

export function useDeleteShipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteShipment(id),
    onSuccess: () => {
      // Deleting reverts the consumed finished goods back to IN_STOCK.
      qc.invalidateQueries({ queryKey: ['shipments'] });
      qc.invalidateQueries({ queryKey: ['finished-goods'] });
    },
  });
}
