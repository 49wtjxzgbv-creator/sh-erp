'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getProductCuttingSpec,
  upsertProductCuttingSpec,
  deleteProductCuttingSpec,
  previewCuttingPlan,
  executeCuttingPlan,
  getCuttingPlan,
  listRemnants,
  type UpsertProductCuttingSpecInput,
  type PreviewCuttingPlanInput,
} from '@/lib/api-client/cutting';

const specKey = (productId: string) => ['product-cutting-spec', productId] as const;
const planKey = (id: string) => ['cutting-plan', id] as const;
const remnantsKey = (filter: { productId?: string; warehouseId?: string }) => ['cutting-remnants', filter] as const;

export function useProductCuttingSpec(productId: string) {
  return useQuery({ queryKey: specKey(productId), queryFn: () => getProductCuttingSpec(productId), enabled: Boolean(productId) });
}

export function useUpsertProductCuttingSpec(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpsertProductCuttingSpecInput) => upsertProductCuttingSpec(productId, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: specKey(productId) }),
  });
}

export function useDeleteProductCuttingSpec(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => deleteProductCuttingSpec(productId),
    onSuccess: () => qc.invalidateQueries({ queryKey: specKey(productId) }),
  });
}

export function usePreviewCuttingPlan() {
  return useMutation({ mutationFn: (dto: PreviewCuttingPlanInput) => previewCuttingPlan(dto) });
}

export function useCuttingPlan(id: string) {
  return useQuery({ queryKey: planKey(id), queryFn: () => getCuttingPlan(id), enabled: Boolean(id) });
}

export function useExecuteCuttingPlan(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => executeCuttingPlan(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: planKey(id) });
      qc.invalidateQueries({ queryKey: ['cutting-remnants'] });
    },
  });
}

export function useRemnants(filter: { productId?: string; warehouseId?: string } = {}) {
  return useQuery({ queryKey: remnantsKey(filter), queryFn: () => listRemnants(filter) });
}
