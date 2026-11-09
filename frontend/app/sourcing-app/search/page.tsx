'use client';

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useSearch } from '../use-sourcing-app';
import { ProductRow } from '../product-row';
import { ProductSheet } from '../product-sheet';
import { CandidateSheet } from '../candidate-sheet';

export default function SourcingAppSearchPage() {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(timeout);
  }, [query]);

  const { data, isFetching } = useSearch(debounced);

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 p-3" style={{ background: 'var(--tg-bg)' }}>
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Пошук за артикулом або назвою у всьому каталозі…"
        />
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
