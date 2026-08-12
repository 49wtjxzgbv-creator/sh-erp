'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  queryProducts,
  getProduct,
  getProductsByIds,
  createProduct,
  updateProduct,
  deleteProduct,
  listCompanyUnits,
  createCompanyUnit,
  deleteCompanyUnit,
  importProducts,
  exportProducts,
  type QueryProductsInput,
  type CreateProductInput,
  type UpdateProductInput,
  type CreateCompanyUnitInput,
} from '@/lib/api-client/catalog';

/**
 * TanStack Query hooks over lib/api-client/catalog.ts. This is the pattern
 * every later module follows: the api-client file stays framework-agnostic
 * (plain typed fetch calls), these hooks own caching/invalidation, and
 * components never call apiClient or the api-client functions directly.
 */

const productsKey = (query: QueryProductsInput) => ['products', query] as const;
const productKey = (id: string) => ['products', id] as const;
const unitsKey = ['company-units'] as const;

export function useProducts(query: QueryProductsInput) {
  return useQuery({ queryKey: productsKey(query), queryFn: () => queryProducts(query) });
}

export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: productKey(id ?? ''),
    queryFn: () => getProduct(id as string),
    enabled: Boolean(id),
  });
}

/** Many products in one call, keyed by id, for list views that only have `productId`s to resolve (e.g. Stock Levels). Mirrors `useFilesForEntities`'s shape. */
export function useProductsByIds(ids: string[]) {
  const sortedIds = [...ids].sort();
  return useQuery({
    queryKey: ['products', 'batch', sortedIds] as const,
    queryFn: async () => {
      const products = await getProductsByIds(sortedIds);
      return new Map(products.map((p) => [p.id, p]));
    },
    enabled: sortedIds.length > 0,
  });
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateProductInput) => createProduct(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });
}

export function useUpdateProduct(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateProductInput) => updateProduct(id, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: productKey(id) });
    },
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteProduct(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });
}

export function useImportProducts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, updateQuantities }: { file: File; updateQuantities: boolean }) => importProducts(file, updateQuantities),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });
}

/**
 * A plain mutation, not a query — an export is a one-shot download action,
 * not a cached resource. Triggers the browser's native save-file flow via a
 * throwaway object URL/anchor click, same as any client-side file download.
 */
export function useExportProducts() {
  return useMutation({
    mutationFn: async () => {
      const blob = await exportProducts();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `products-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
  });
}

export function useCompanyUnits() {
  return useQuery({ queryKey: unitsKey, queryFn: () => listCompanyUnits() });
}

export function useCreateCompanyUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateCompanyUnitInput) => createCompanyUnit(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: unitsKey }),
  });
}

export function useDeleteCompanyUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteCompanyUnit(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: unitsKey }),
  });
}
