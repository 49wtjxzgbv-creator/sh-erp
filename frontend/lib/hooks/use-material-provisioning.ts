'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getMaterialProvisioningSummary,
  saveMaterialProvisioningDecision,
  type SaveMaterialProvisioningDecisionInput,
} from '@/lib/api-client/material-provisioning';

const provisioningKey = (orderId: string, itemId: string) => ['customer-orders', orderId, 'items', itemId, 'provisioning'] as const;

export function useMaterialProvisioningSummary(orderId: string, itemId: string | undefined) {
  return useQuery({
    queryKey: provisioningKey(orderId, itemId ?? ''),
    queryFn: () => getMaterialProvisioningSummary(orderId, itemId as string),
    enabled: Boolean(orderId && itemId),
  });
}

/**
 * Saves the stock-vs-purchase split for one material on one order line —
 * immediately reserves the stock-side delta, so this can 409 (insufficient
 * available) as a real, expected outcome, not just a network error.
 * Invalidates the warehouse levels list too since reserving from stock
 * changes every product's reservedQty/availableQty there.
 */
export function useSaveMaterialProvisioningDecision(orderId: string, itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, dto }: { productId: string; dto: SaveMaterialProvisioningDecisionInput }) =>
      saveMaterialProvisioningDecision(orderId, itemId, productId, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: provisioningKey(orderId, itemId) });
      qc.invalidateQueries({ queryKey: ['stock-levels'] });
      qc.invalidateQueries({ queryKey: ['stock-reservations'] });
    },
  });
}
