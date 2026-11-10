'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-client/types';
import {
  sourcingAppClient,
  type ProductListResponse,
  type ProductDetail,
  type SourcingCategorySummary,
  type RealSupplier,
  type CandidateSupplier,
  type StatusOverview,
  type UpdateOutreachInput,
  type CreateCandidateInput,
} from './sourcing-app-client';

/** The Mini App's own "not paired yet" screen checks for this specific code (TelegramWebAppAuthGuard) rather than a generic error state. */
export function isNotPairedError(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'SOURCING_BOT_NOT_PAIRED';
}

/** `enabled` gates this until the Telegram SDK script has actually finished loading — calling before then would send an empty `initData` and spuriously fail. */
export function useMe(enabled: boolean) {
  return useQuery({
    queryKey: ['sourcing-app', 'me'],
    queryFn: () => sourcingAppClient.get<{ fullName: string; isAdmin: boolean }>('me'),
    enabled,
    retry: false,
    staleTime: 10 * 60 * 1000,
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ['sourcing-app', 'categories'],
    queryFn: () => sourcingAppClient.get<SourcingCategorySummary[]>('categories'),
    staleTime: 5 * 60 * 1000,
  });
}

export function useCategoryProducts(categoryId: string, search: string, page: number) {
  return useQuery({
    queryKey: ['sourcing-app', 'categories', categoryId, 'products', search, page],
    queryFn: () => sourcingAppClient.get<ProductListResponse>(`categories/${categoryId}/products`, { search: search || undefined, page: String(page) }),
    enabled: Boolean(categoryId),
  });
}

export function useProductDetail(productId: string | null) {
  return useQuery({
    queryKey: ['sourcing-app', 'products', productId],
    queryFn: () => sourcingAppClient.get<ProductDetail>(`products/${productId}`),
    enabled: Boolean(productId),
  });
}

export function useSearch(query: string) {
  return useQuery({
    queryKey: ['sourcing-app', 'search', query],
    queryFn: () => sourcingAppClient.get<{ items: ProductListResponse['items'] }>('search', { q: query }),
    enabled: query.trim().length >= 2,
  });
}

export function useSuppliers() {
  return useQuery({
    queryKey: ['sourcing-app', 'suppliers'],
    queryFn: () => sourcingAppClient.get<RealSupplier[]>('suppliers'),
    staleTime: 5 * 60 * 1000,
  });
}

export function useCandidates(categoryId?: string, region?: string) {
  return useQuery({
    queryKey: ['sourcing-app', 'candidates', categoryId, region],
    queryFn: () => sourcingAppClient.get<CandidateSupplier[]>('candidates', { categoryId, region }),
  });
}

export function useStatusOverview() {
  return useQuery({
    queryKey: ['sourcing-app', 'status'],
    queryFn: () => sourcingAppClient.get<StatusOverview>('status'),
  });
}

/** "має бути можливість додавати можливих постачальників" (2026-11-10) — the server independently enforces admin-only (403 otherwise); the Postачальники page only shows the button when `useMe().isAdmin` is true. */
export function useCreateCandidate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCandidateInput) => sourcingAppClient.post('candidates', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sourcing-app', 'candidates'] });
      qc.invalidateQueries({ queryKey: ['sourcing-app', 'status'] });
    },
  });
}

export function useUpdateOutreach() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ candidateId, input }: { candidateId: string; input: UpdateOutreachInput }) =>
      sourcingAppClient.patch(`candidates/${candidateId}/outreach`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sourcing-app', 'candidates'] });
      qc.invalidateQueries({ queryKey: ['sourcing-app', 'status'] });
      qc.invalidateQueries({ queryKey: ['sourcing-app', 'products'] });
    },
  });
}
