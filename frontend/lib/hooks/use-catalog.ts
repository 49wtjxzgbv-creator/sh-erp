'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  queryProducts,
  getProduct,
  getProductsByIds,
  createProduct,
  updateProduct,
  deleteProduct,
  bulkDeleteProducts,
  listCompanyUnits,
  createCompanyUnit,
  deleteCompanyUnit,
  importProducts,
  exportProducts,
  getProductSuppliers,
  setProductSuppliers,
  type QueryProductsInput,
  type CreateProductInput,
  type UpdateProductInput,
  type CreateCompanyUnitInput,
  type SetProductSupplierInput,
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

/**
 * Bulk delete for the catalog table's row-selection UI — one request via
 * `POST /products/bulk-delete`, not N parallel single-product DELETE calls.
 * That N-parallel-request shape was the original implementation and caused
 * a real incident: a "select all" delete of ~140 products blew through the
 * backend's per-client rate limit (100 req/60s), so only a couple of
 * requests fit under whatever budget was left before the rest silently
 * 429'd — "select all" appeared to delete almost nothing.
 */
export function useDeleteProducts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => bulkDeleteProducts(ids),
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

const productSuppliersKey = (productId: string) => ['products', productId, 'suppliers'] as const;

export function useProductSuppliers(productId: string | undefined) {
  return useQuery({
    queryKey: productSuppliersKey(productId ?? ''),
    queryFn: () => getProductSuppliers(productId as string),
    enabled: Boolean(productId),
  });
}

export function useSetProductSuppliers(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (suppliers: SetProductSupplierInput[]) => setProductSuppliers(productId, suppliers),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: productSuppliersKey(productId) });
      // The default supplier's price may have just overwritten sellPriceEur
      // server-side (ProductsService#setSuppliers) — refetch the product
      // itself so the "Ціна продажу" field on the same form doesn't show a
      // stale value until the next full reload.
      qc.invalidateQueries({ queryKey: productKey(productId) });
      qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}
