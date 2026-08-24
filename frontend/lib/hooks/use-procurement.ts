'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  querySuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  invitePortal,
  deactivatePortal,
  createSupplierInviteLink,
  connectExistingSupplier,
  getSupplierLinkedProducts,
  getSupplierLinkedAssemblies,
  queryPurchaseOrders,
  getPurchaseOrder,
  createPurchaseOrder,
  deletePurchaseOrder,
  receivePurchaseOrder,
  updatePurchaseOrderMilestones,
  createDeliverySchedule,
  acceptDeliverySchedule,
  rejectDeliverySchedule,
  listPurchaseOrderComments,
  addPurchaseOrderComment,
  type QuerySuppliersInput,
  type CreateSupplierInput,
  type UpdateSupplierInput,
  type QueryPurchaseOrdersInput,
  type CreatePurchaseOrderInput,
  type ReceivePurchaseOrderInput,
  type UpdatePurchaseOrderMilestonesInput,
  type DeliveryScheduleLineInput,
} from '@/lib/api-client/procurement';

const suppliersKey = (query: QuerySuppliersInput) => ['suppliers', query] as const;
const supplierKey = (id: string) => ['suppliers', id] as const;
const purchaseOrdersKey = (query: QueryPurchaseOrdersInput) => ['purchase-orders', query] as const;
const purchaseOrderKey = (id: string) => ['purchase-orders', id] as const;

export function useSuppliers(query: QuerySuppliersInput) {
  return useQuery({ queryKey: suppliersKey(query), queryFn: () => querySuppliers(query) });
}

export function useSupplier(id: string | undefined) {
  return useQuery({
    queryKey: supplierKey(id ?? ''),
    queryFn: () => getSupplier(id as string),
    enabled: Boolean(id),
  });
}

export function useSupplierLinkedProducts(supplierId: string | undefined) {
  return useQuery({
    queryKey: ['suppliers', supplierId ?? '', 'products'] as const,
    queryFn: () => getSupplierLinkedProducts(supplierId as string),
    enabled: Boolean(supplierId),
  });
}

export function useSupplierLinkedAssemblies(supplierId: string | undefined) {
  return useQuery({
    queryKey: ['suppliers', supplierId ?? '', 'assemblies'] as const,
    queryFn: () => getSupplierLinkedAssemblies(supplierId as string),
    enabled: Boolean(supplierId),
  });
}

export function useCreateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateSupplierInput) => createSupplier(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers'] }),
  });
}

export function useUpdateSupplier(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateSupplierInput) => updateSupplier(id, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      qc.invalidateQueries({ queryKey: supplierKey(id) });
    },
  });
}

export function useDeleteSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteSupplier(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers'] }),
  });
}

export function useInvitePortal(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: { email?: string } = {}) => invitePortal(id, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: supplierKey(id) }),
  });
}

export function useDeactivatePortal(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => deactivatePortal(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: supplierKey(id) }),
  });
}

export function useCreateSupplierInviteLink(id: string) {
  return useMutation({
    mutationFn: () => createSupplierInviteLink(id),
  });
}

export function useConnectExistingSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: { email: string; name: string }) => connectExistingSupplier(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers'] }),
  });
}

export function usePurchaseOrders(query: QueryPurchaseOrdersInput) {
  return useQuery({ queryKey: purchaseOrdersKey(query), queryFn: () => queryPurchaseOrders(query) });
}

export function usePurchaseOrder(id: string | undefined) {
  return useQuery({
    queryKey: purchaseOrderKey(id ?? ''),
    queryFn: () => getPurchaseOrder(id as string),
    enabled: Boolean(id),
  });
}

export function useCreatePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreatePurchaseOrderInput) => createPurchaseOrder(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['purchase-orders'] }),
  });
}

/** Permanent hard delete — admin-only, cannot be undone. */
export function useDeletePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deletePurchaseOrder(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['purchase-orders'] }),
  });
}

export function useReceivePurchaseOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: ReceivePurchaseOrderInput) => receivePurchaseOrder(id, dto),
    onSuccess: () => {
      // Receiving posts real RECEIVE stock movements — stock views go stale too.
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      qc.invalidateQueries({ queryKey: purchaseOrderKey(id) });
      qc.invalidateQueries({ queryKey: ['stock-levels'] });
      qc.invalidateQueries({ queryKey: ['stock-history'] });
    },
  });
}

export function useUpdatePurchaseOrderMilestones() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdatePurchaseOrderMilestonesInput }) =>
      updatePurchaseOrderMilestones(id, dto),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      qc.invalidateQueries({ queryKey: purchaseOrderKey(id) });
    },
  });
}

export function useCreateDeliverySchedule(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, lines }: { itemId: string; lines: DeliveryScheduleLineInput[] }) => createDeliverySchedule(orderId, itemId, lines),
    onSuccess: () => qc.invalidateQueries({ queryKey: purchaseOrderKey(orderId) }),
  });
}

export function useAcceptDeliverySchedule(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scheduleId: string) => acceptDeliverySchedule(orderId, scheduleId),
    onSuccess: () => qc.invalidateQueries({ queryKey: purchaseOrderKey(orderId) }),
  });
}

export function useRejectDeliverySchedule(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scheduleId: string) => rejectDeliverySchedule(orderId, scheduleId),
    onSuccess: () => qc.invalidateQueries({ queryKey: purchaseOrderKey(orderId) }),
  });
}

const purchaseOrderCommentsKey = (orderId: string) => ['purchase-orders', orderId, 'comments'] as const;

export function usePurchaseOrderComments(orderId: string | undefined) {
  return useQuery({
    queryKey: purchaseOrderCommentsKey(orderId ?? ''),
    queryFn: () => listPurchaseOrderComments(orderId as string),
    enabled: Boolean(orderId),
  });
}

export function useAddPurchaseOrderComment(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => addPurchaseOrderComment(orderId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: purchaseOrderCommentsKey(orderId) }),
  });
}
