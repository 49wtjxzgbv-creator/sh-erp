'use client';

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useSearch, useBulkTranslate, type ProductFilter } from '../use-sourcing-app';
import { ProductRow } from '../product-row';
import { ProductSheet } from '../product-sheet';
import { CandidateSheet } from '../candidate-sheet';
import { ProductFilterChips } from '../product-filter-chips';

export default function SourcingAppSearchPage() {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filter, setFilter] = useState<ProductFilter>(undefined);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(timeout);
  }, [query]);

  const { data, isFetching } = useSearch(debounced, filter);
  const { translateAll, progress } = useBulkTranslate();

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10" style={{ background: 'var(--tg-bg)' }}>
        <div className="p-3 pb-2">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Пошук за артикулом або назвою у всьому каталозі…"
          />
        </div>
        <div className="flex items-center gap-2 px-3 pb-2">
          <div className="flex-1 overflow-x-auto">
            <ProductFilterChips value={filter} onChange={setFilter} />
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
        {debounced.trim().length < 2 ? (
          <p className="p-6 text-center text-sm" style={{ color: 'var(--tg-hint)' }}>Введіть хоча б 2 символи.</p>
        ) : isFetching ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : !data || data.items.length === 0 ? (
          <p className="p-6 text-center text-sm" style={{ color: 'var(--tg-hint)' }}>Нічого не знайдено за «{debounced}».</p>
        ) : (
          data.items.map((product) => <ProductRow key={product.id} product={product} onClick={() => setSelectedProductId(product.id)} />)
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
