'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useCategoryProducts, useBulkTranslate, type ProductFilter } from '../../use-sourcing-app';
import { useTelegramBackButton } from '../../use-telegram-back-button';
import { ProductRow } from '../../product-row';
import { ProductSheet } from '../../product-sheet';
import { CandidateSheet } from '../../candidate-sheet';
import { ProductFilterChips } from '../../product-filter-chips';

export default function CategoryProductsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<ProductFilter>(undefined);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);

  // "натискаємо повернутись назад то має повертатися у попереднє меню а не
  // на головне" (2026-11-10) — router.back(), not a hardcoded push to
  // /sourcing-app: the home page's Категорії/Виробами tab is reflected in
  // its own URL (?mode=...), so a real back-navigation lands on whichever
  // tab was actually active, not always the default one.
  useTelegramBackButton(() => router.back());

  const { data, isLoading } = useCategoryProducts(params.id, search, page, filter);
  const { translateAll, progress } = useBulkTranslate();

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10" style={{ background: 'var(--tg-bg)' }}>
        <div className="p-3 pb-2">
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Пошук за артикулом або назвою…"
          />
        </div>
        <div className="flex items-center gap-2 px-3 pb-2">
          <div className="flex-1 overflow-x-auto">
            <ProductFilterChips value={filter} onChange={(next) => { setFilter(next); setPage(0); }} />
          </div>
          {data && data.items.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              disabled={Boolean(progress)}
              onClick={() => translateAll(data.items.map((p) => p.name))}
            >
              {progress ? `… ${progress.done}/${progress.total}` : '🇺🇦 Перекласти всі'}
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1">
        {isLoading ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : !data || data.items.length === 0 ? (
          <p className="p-6 text-center text-sm" style={{ color: 'var(--tg-hint)' }}>Нічого не знайдено.</p>
        ) : (
          <>
            {data.items.map((product) => (
              <ProductRow key={product.id} product={product} onClick={() => setSelectedProductId(product.id)} />
            ))}
            {(page > 0 || data.hasMore) && (
              <div className="flex items-center justify-center gap-2 p-3">
                {page > 0 && (
                  <Button variant="outline" size="sm" onClick={() => setPage((p) => p - 1)}>
                    ⬅️ Попередні
                  </Button>
                )}
                {data.hasMore && (
                  <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)}>
                    Наступні ➡️
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <ProductSheet
        productId={selectedProductId}
        onClose={() => setSelectedProductId(null)}
        onOpenCandidate={(candidateId) => setSelectedCandidateId(candidateId)}
      />
      <CandidateSheet candidateId={selectedCandidateId} onClose={() => setSelectedCandidateId(null)} />
    </div>
  );
}
