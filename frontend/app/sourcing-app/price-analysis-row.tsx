'use client';

import { formatEur } from '@/lib/utils';
import type { PriceAnalysisRow as PriceAnalysisRowData } from './sourcing-app-client';

/**
 * "аналізатор по цінах... відсоткове співвідношення" (2026-11-25) — one row
 * per product, the spread % front and center (the whole point of this
 * screen: where switching to the cheapest supplier saves the most).
 */
export function PriceAnalysisRow({ product, onClick }: { product: PriceAnalysisRowData; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 border-b px-4 py-3 text-left active:opacity-70"
      style={{ borderColor: 'color-mix(in srgb, var(--tg-hint) 15%, transparent)' }}
    >
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg" style={{ background: 'var(--tg-secondary-bg)' }}>
        {product.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL
          <img src={product.photoUrl} alt={product.name} className="h-full w-full object-contain" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-lg">📦</div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{product.article} — {product.name}</p>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--tg-hint)' }}>
          🏭 {product.supplierCount} · {formatEur(product.minPrice)} – {formatEur(product.maxPrice)}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-base font-bold" style={{ color: '#d97706' }}>+{Math.round(product.spreadPercent)}%</p>
      </div>
    </button>
  );
}
