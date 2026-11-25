'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { usePriceAnalysis } from '../use-sourcing-app';
import { useTelegramBackButton } from '../use-telegram-back-button';
import { PriceAnalysisRow } from '../price-analysis-row';
import { ProductSheet } from '../product-sheet';
import { CandidateSheet } from '../candidate-sheet';

/**
 * "потрібен в застосунку аналізатор по цінах... між всіма постачальками і
 * цінами загалом відсоткове співвідношення" (2026-11-25) — a dedicated
 * tab ranking products by how far their real suppliers' prices diverge
 * (max vs min), biggest spread first: where switching suppliers saves the
 * most. Tapping a row opens the SAME ProductSheet as everywhere else,
 * which already shows every real supplier's price with a
 * "+N% від найдешевшої" / "💚 найдешевша" badge per supplier
 * (real-supplier-row.tsx) — this screen is the entry point, not a second
 * place that duplicates that comparison UI.
 */
export default function PriceAnalysisPage() {
  const router = useRouter();
  const [page, setPage] = useState(0);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);

  useTelegramBackButton(() => router.back());

  const { data, isLoading } = usePriceAnalysis(page);

  useEffect(() => {
    document.getElementById('sourcing-app-scroll')?.scrollTo({ top: 0 });
  }, [page]);

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 border-b p-4" style={{ background: 'var(--tg-bg)', borderColor: 'color-mix(in srgb, var(--tg-hint) 15%, transparent)' }}>
        <p className="text-sm font-semibold">📈 Аналіз цін</p>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--tg-hint)' }}>
          Товари, де ціни постачальників найбільше відрізняються — найбільша економія від переходу на найдешевшого спочатку.
        </p>
      </div>

      <div className="flex-1">
        {isLoading ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : !data || data.items.length === 0 ? (
          <p className="p-6 text-center text-sm" style={{ color: 'var(--tg-hint)' }}>
            Немає товарів із 2+ реальними постачальниками для порівняння.
          </p>
        ) : (
          <>
            {data.items.map((product) => (
              <PriceAnalysisRow key={product.id} product={product} onClick={() => setSelectedProductId(product.id)} />
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
