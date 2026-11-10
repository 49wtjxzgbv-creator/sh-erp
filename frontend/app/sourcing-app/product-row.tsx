'use client';

import { PriceChips } from './price-chips';
import { useTranslateName } from './use-sourcing-app';
import { formatWeightKg } from './format-weight';
import type { ProductRow as ProductRowData } from './sourcing-app-client';

export function ProductRow({ product, onClick }: { product: ProductRowData; onClick: () => void }) {
  // "перекласти всі" (2026-11-10) — reads the shared translate cache only
  // (never fetches on its own, `enabled: false`); reactively shows the
  // translated name the instant `useBulkTranslate`'s own fetch for this
  // exact product name lands, with zero extra wiring here.
  const { data: translation } = useTranslateName(product.name);
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 border-b px-4 py-3 text-left active:opacity-70"
      style={{ borderColor: 'color-mix(in srgb, var(--tg-hint) 15%, transparent)' }}
    >
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg" style={{ background: 'var(--tg-secondary-bg)' }}>
        {product.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL, not an optimizable local/static asset
          <img src={product.photoUrl} alt={product.name} className="h-full w-full object-contain" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-lg">📦</div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{product.article} — {product.name}</p>
        {translation && <p className="truncate text-xs" style={{ color: 'var(--tg-link)' }}>{translation.translated}</p>}
        <div className="mt-1">
          <PriceChips prices={product.prices} compact />
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5 text-xs" style={{ color: 'var(--tg-hint)' }}>
        {product.supplierCount > 0 && <span>🏭 {product.supplierCount}</span>}
        {product.weightKg !== null && <span>⚖️ {formatWeightKg(product.weightKg)}</span>}
      </div>
    </button>
  );
}
