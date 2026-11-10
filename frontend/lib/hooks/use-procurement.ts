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
  generatePurchaseOrderPdf,
  getPurchaseOrderBatch,
  generateCombinedPurchaseOrderPdf,
  deletePurchaseOrder,
  receivePurchaseOrder,
  updatePurchaseOrderMilestones,
  createDeliverySchedule,
  acceptDeliverySchedule,
  rejectDeliverySchedule,
  getDeliveryScheduleSiblings,
  createGroupedDeliverySchedule,
  listPurchaseOrderComments,
  addPurchaseOrderComment,
  queryPurchaseRequests,
  getPurchaseRequest,
  createPurchaseRequest,
  updatePurchaseRequest,
  savePurchaseRequestItems,
  sendPurchaseRequest,
  generatePurchaseRequestPdf,
  cancelPurchaseRequest,
  convertPurchaseRequestToOrder,
  deletePurchaseRequest,
  queryPriceProposals,
  approvePriceProposal,
  rejectPriceProposal,
  type QuerySuppliersInput,
  type CreateSupplierInput,
  type UpdateSupplierInput,
  type QueryPurchaseOrdersInput,
  type CreatePurchaseOrderInput,
  type ReceivePurchaseOrderInput,
  type UpdatePurchaseOrderMilestonesInput,
  type DeliveryScheduleLineInput,
  type BulkCreateDeliveryScheduleInput,
  type QueryPurchaseRequestsInput,
  type CreatePurchaseRequestInput,
  type UpdatePurchaseRequestInput,
  type PurchaseRequestItemInput,
} from '@/lib/api-client/procurement';

const suppliersKey = (query: QuerySuppliersInput) => ['suppliers', query] as const;
const supplierKey = (id: string) => ['suppliers', id] as const;
const purchaseOrdersKey = (query: QueryPurchaseOrdersInput) => ['purchase-orders', query] as const;
const purchaseOrderKey = (id: string) => ['purchase-orders', id] as const;
const purchaseRequestsKey = (query: QueryPurchaseRequestsInput) => ['purchase-requests', query] as const;
const purchaseRequestKey = (id: string) => ['purchase-requests', id] as const;

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

export function useGeneratePurchaseOrderPdf(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => generatePurchaseOrderPdf(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: purchaseOrderKey(id) }),
  });
}

/** "приписка щоб розуміти з якого замовлення береться ця заявка" — every sibling order fanned out from the same заявка conversion. */
export function usePurchaseOrderBatch(id: string | undefined) {
  return useQuery({
    queryKey: ['purchase-orders', 'batch', id ?? ''] as const,
    queryFn: () => getPurchaseOrderBatch(id as string),
    enabled: Boolean(id),
  });
}

/** Invalidates every sibling order in the batch, not just the one clicked — all of them get the same combinedPdfFileId stamped server-side. */
export function useGenerateCombinedPurchaseOrderPdf(id: string, siblingOrderIds: string[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => generateCombinedPurchaseOrderPdf(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: purchaseOrderKey(id) });
      siblingOrderIds.forEach((siblingId) => qc.invalidateQueries({ queryKey: purchaseOrderKey(siblingId) }));
    },
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

/** Lazy — only meaningful while deciding whether to show the "fill once for the group" flow, so callers pass `enabled`. */
export function useDeliveryScheduleSiblings(itemId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['delivery-schedule-siblings', itemId ?? ''],
    queryFn: () => getDeliveryScheduleSiblings(itemId as string),
    enabled: Boolean(itemId) && enabled,
  });
}

/**
 * Siblings can span several different PurchaseOrders — `orderIds` (every
 * distinct order the group touches, known client-side from the siblings
 * query) is passed alongside the real DTO purely so onSuccess can
 * invalidate each of those orders' own cached detail pages, not just one.
 */
export function useCreateGroupedDeliverySchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dto }: { dto: BulkCreateDeliveryScheduleInput; orderIds: string[] }) => createGroupedDeliverySchedule(dto),
    onSuccess: (_data, { orderIds }) => {
      orderIds.forEach((id) => qc.invalidateQueries({ queryKey: purchaseOrderKey(id) }));
    },
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

export function usePurchaseRequests(query: QueryPurchaseRequestsInput) {
  return useQuery({ queryKey: purchaseRequestsKey(query), queryFn: () => queryPurchaseRequests(query) });
}

export function usePurchaseRequest(id: string | undefined) {
  return useQuery({
    queryKey: purchaseRequestKey(id ?? ''),
    queryFn: () => getPurchaseRequest(id as string),
    enabled: Boolean(id),
  });
}

export function useCreatePurchaseRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreatePurchaseRequestInput) => createPurchaseRequest(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['purchase-requests'] }),
  });
}

export function useUpdatePurchaseRequest(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdatePurchaseRequestInput) => updatePurchaseRequest(id, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-requests'] });
      qc.invalidateQueries({ queryKey: purchaseRequestKey(id) });
    },
  });
}

export function useSavePurchaseRequestItems(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: PurchaseRequestItemInput[]) => savePurchaseRequestItems(id, items),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-requests'] });
      qc.invalidateQueries({ queryKey: purchaseRequestKey(id) });
    },
  });
}

export function useSendPurchaseRequest(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => sendPurchaseRequest(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-requests'] });
      qc.invalidateQueries({ queryKey: purchaseRequestKey(id) });
    },
  });
}

export function useGeneratePurchaseRequestPdf(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => generatePurchaseRequestPdf(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-requests'] });
      qc.invalidateQueries({ queryKey: purchaseRequestKey(id) });
    },
  });
}

export function useCancelPurchaseRequest(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => cancelPurchaseRequest(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-requests'] });
      qc.invalidateQueries({ queryKey: purchaseRequestKey(id) });
    },
  });
}

/** Creates a real PurchaseOrder, so both lists must go stale together. */
export function useConvertPurchaseRequestToOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => convertPurchaseRequestToOrder(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-requests'] });
      qc.invalidateQueries({ queryKey: purchaseRequestKey(id) });
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
    },
  });
}

/** DRAFT only — use useCancelPurchaseRequest for a sent one. */
export function useDeletePurchaseRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deletePurchaseRequest(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['purchase-requests'] }),
  });
}

/** "правка ціни щоб було тільки через підтвердження в основній erp" (2026-11-10) — review queue for price changes proposed from the Telegram sourcing Mini App. */
export function usePriceProposals() {
  return useQuery({ queryKey: ['price-proposals'], queryFn: () => queryPriceProposals() });
}

export function useApprovePriceProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => approvePriceProposal(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['price-proposals'] }),
  });
}

export function useRejectPriceProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rejectPriceProposal(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['price-proposals'] }),
  });
}
