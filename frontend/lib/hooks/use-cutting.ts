'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getProductCuttingSpec,
  upsertProductCuttingSpec,
  deleteProductCuttingSpec,
  extractDefaultCutShape,
  extractShape,
  previewCuttingPlan,
  executeCuttingPlan,
  getCuttingPlan,
  exportStockItemDxf,
  listRemnants,
  listCuttableProducts,
  type UpsertProductCuttingSpecInput,
  type PreviewCuttingPlanInput,
} from '@/lib/api-client/cutting';

const specKey = (productId: string) => ['product-cutting-spec', productId] as const;
const planKey = (id: string) => ['cutting-plan', id] as const;
const remnantsKey = (filter: { productId?: string; warehouseId?: string }) => ['cutting-remnants', filter] as const;
const cuttableProductsKey = (filter: { search?: string; limit?: number; offset?: number }) => ['cuttable-products', filter] as const;

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

/** Direct-product cutting (2026-11-01): upload a STEP file → candidate piece shapes for the product's own default cut shape. */
export function useExtractDefaultCutShape(productId: string) {
  return useMutation({ mutationFn: (fileAssetId: string) => extractDefaultCutShape(productId, fileAssetId) });
}

/** Ad-hoc multi-material worksheet (2026-11-01): upload a STEP file → candidate piece shapes for a worksheet position with no product of its own. */
export function useExtractShape() {
  return useMutation({ mutationFn: (fileAssetId: string) => extractShape(fileAssetId) });
}

export function useCuttableProducts(filter: { search?: string; limit?: number; offset?: number } = {}) {
  return useQuery({ queryKey: cuttableProductsKey(filter), queryFn: () => listCuttableProducts(filter) });
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

/**
 * Downloads one sheet stock item's computed nesting layout as a DXF file —
 * same throwaway object-URL/anchor-click download as useExportProducts(),
 * just keyed by stockItemId since a plan can have several sheets.
 */
export function useExportStockItemDxf(planId: string) {
  return useMutation({
    mutationFn: async (stockItemId: string) => {
      const blob = await exportStockItemDxf(planId, stockItemId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rozkrij-${stockItemId.slice(0, 8)}.dxf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
  });
}
