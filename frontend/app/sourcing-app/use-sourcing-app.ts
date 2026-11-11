'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-client/types';
import {
  sourcingAppClient,
  type ProductListResponse,
  type ProductDetail,
  type SourcingCategorySummary,
  type RealSupplier,
  type SupplierListResponse,
  type OutreachLetter,
  type CandidateSupplier,
  type StatusOverview,
  type UpdateOutreachInput,
  type CreateCandidateInput,
  type AssemblySummary,
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

/** "фільтри в списку товарів — лише без жодного постачальника / лише без ціни" (2026-11-10). */
export type ProductFilter = 'noSupplier' | 'noPrice' | undefined;

export function useCategoryProducts(categoryId: string, search: string, page: number, filter?: ProductFilter) {
  return useQuery({
    queryKey: ['sourcing-app', 'categories', categoryId, 'products', search, page, filter],
    queryFn: () => sourcingAppClient.get<ProductListResponse>(`categories/${categoryId}/products`, { search: search || undefined, page: String(page), filter }),
    enabled: Boolean(categoryId),
  });
}

/** "пошук товарів не по категоріям а по виробах" (2026-11-10). */
export function useAssemblies() {
  return useQuery({
    queryKey: ['sourcing-app', 'assemblies'],
    queryFn: () => sourcingAppClient.get<AssemblySummary[]>('assemblies'),
    staleTime: 5 * 60 * 1000,
  });
}

export function useAssemblyProducts(assemblyId: string, search: string, page: number, filter?: ProductFilter) {
  return useQuery({
    queryKey: ['sourcing-app', 'assemblies', assemblyId, 'products', search, page, filter],
    queryFn: () => sourcingAppClient.get<ProductListResponse>(`assemblies/${assemblyId}/products`, { search: search || undefined, page: String(page), filter }),
    enabled: Boolean(assemblyId),
  });
}

/**
 * "додай можливість перекладу назв товарів на українську" (2026-11-10) —
 * on-demand, not automatic (most names are German). `useQuery` with
 * `enabled: false` rather than a mutation — this keys the result on the
 * exact text being translated, so retapping the SAME name within a
 * session (or after navigating away and back to the same product) reuses
 * the cached translation instead of re-spending an AI call. Triggered via
 * the returned `refetch`.
 */
export function useTranslateName(text: string) {
  return useQuery({
    queryKey: ['sourcing-app', 'translate', text],
    queryFn: () => sourcingAppClient.post<{ translated: string }>('translate', { text }),
    enabled: false,
    staleTime: Infinity,
    retry: false,
  });
}

/**
 * "перекласти всі" (2026-11-10) — fans out `useTranslateName`'s own query
 * through the query client directly, into the EXACT SAME cache keys
 * (`['sourcing-app', 'translate', name]`) — any `ProductRow`/`ProductSheet`
 * already mounted for one of these names re-renders the instant its own
 * translation lands, with no extra plumbing (React Query shares cache
 * across every observer of the same key, `enabled: false` only skips
 * THIS hook's own auto-fetch, not its subscription to the cache).
 * Bounded concurrency, not `Promise.all` over the whole list — matches
 * `GeminiAdapter`'s own one-shot quota-retry design, not meant to be
 * hammered by a dozen simultaneous calls at once. Already-cached names
 * are skipped so retapping "перекласти всі" after opening a few products
 * individually doesn't re-spend AI calls on those.
 */
export function useBulkTranslate() {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<{ total: number; done: number } | null>(null);
  const CONCURRENCY = 3;

  async function translateAll(names: string[]) {
    const pending = [...new Set(names.filter((n) => n.trim().length > 0))].filter(
      (n) => qc.getQueryData(['sourcing-app', 'translate', n]) === undefined,
    );
    if (pending.length === 0) return;
    setProgress({ total: pending.length, done: 0 });

    let nextIndex = 0;
    async function worker() {
      while (nextIndex < pending.length) {
        const name = pending[nextIndex++];
        try {
          await qc.fetchQuery({
            queryKey: ['sourcing-app', 'translate', name],
            queryFn: () => sourcingAppClient.post<{ translated: string }>('translate', { text: name }),
            staleTime: Infinity,
          });
        } catch {
          // Leave this one name uncached — the per-product 🇺🇦 button in
          // ProductSheet still works for it individually; one failure
          // (e.g. provider misconfigured) must not abort the whole batch.
        }
        setProgress((s) => (s ? { ...s, done: s.done + 1 } : s));
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));
    setProgress(null);
  }

  return { translateAll, progress };
}

export function useProductDetail(productId: string | null) {
  return useQuery({
    queryKey: ['sourcing-app', 'products', productId],
    queryFn: () => sourcingAppClient.get<ProductDetail>(`products/${productId}`),
    enabled: Boolean(productId),
  });
}

export function useSearch(query: string, filter?: ProductFilter) {
  return useQuery({
    queryKey: ['sourcing-app', 'search', query, filter],
    queryFn: () => sourcingAppClient.get<{ items: ProductListResponse['items']; total: number; hasMore: boolean }>('search', { q: query, filter }),
    enabled: query.trim().length >= 2,
  });
}

/** "у списку постачальників наших теж має бути пагінація" (2026-11-11) — getSuppliers had no pagination at all before, unlike every product list. */
export function useSuppliers(page = 0) {
  return useQuery({
    queryKey: ['sourcing-app', 'suppliers', page],
    queryFn: () => sourcingAppClient.get<SupplierListResponse>('suppliers', { page: String(page) }),
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

/**
 * "має бути можливість додавати можливих постачальників" (2026-11-10) —
 * the server independently enforces admin-only (403 otherwise); the
 * Постачальники page only shows the button when `useMe().isAdmin` is true.
 *
 * "додав постачальника з картки товару, а він там не з'явився" (2026-11-11)
 * — `input.productId`, when present (set by `AddCandidateSheet` whenever
 * it was opened from a product's own card), is stripped out before
 * posting (the backend DTO doesn't know this field) but still invalidates
 * that exact product's own detail query, so its `candidateSuppliers` list
 * reflects the addition without needing the sheet closed and reopened.
 */
export function useCreateCandidate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ productId: _productId, ...input }: CreateCandidateInput) => sourcingAppClient.post('candidates', input),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['sourcing-app', 'candidates'] });
      qc.invalidateQueries({ queryKey: ['sourcing-app', 'status'] });
      if (variables.productId) qc.invalidateQueries({ queryKey: ['sourcing-app', 'products', variables.productId] });
    },
  });
}

/** "правка ціни щоб було тільки через підтвердження в основній erp" (2026-11-10) — server-enforced admin-only (403 otherwise), same as useCreateCandidate; never writes a price itself, only proposes one for a human to confirm. */
export function useCreatePriceProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { productId: string; supplierId: string; proposedPriceEur: number; note?: string }) =>
      sourcingAppClient.post<{ id: string; status: string }>('price-proposals', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sourcing-app', 'products'] });
      // "у SupplierSheet теж має бути можливість запропонувати ціну" (2026-11-11) — getSuppliers now carries the same pendingProposal shape, so a proposal made from either sheet must refresh both.
      qc.invalidateQueries({ queryKey: ['sourcing-app', 'suppliers'] });
    },
  });
}

/** "сформувати листа" (2026-11-11) — stateless on the server (see SourcingAppService#generateOutreachLetter's own comment), so nothing here needs cache invalidation either; purely a query-shaped mutation. */
export function useGenerateOutreachLetter() {
  return useMutation({
    mutationFn: (candidateId: string) => sourcingAppClient.post<OutreachLetter>(`candidates/${candidateId}/outreach-letter`),
  });
}

export function useSendOutreachLetterEmail() {
  return useMutation({
    mutationFn: ({ candidateId, text }: { candidateId: string; text: string }) =>
      sourcingAppClient.post<{ sent: boolean }>(`candidates/${candidateId}/outreach-letter/send`, { text }),
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

/** "нотатки до товару/постачальника — короткий текстовий комент, видимий усій команді" (2026-11-10) — an empty note clears it (server-side: see UpsertNoteDto's own comment). */
export function useUpsertNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { entityType: 'Product' | 'Supplier'; entityId: string; note: string }) =>
      sourcingAppClient.patch<{ note: string | null }>('notes', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sourcing-app', 'products'] });
      qc.invalidateQueries({ queryKey: ['sourcing-app', 'suppliers'] });
    },
  });
}
