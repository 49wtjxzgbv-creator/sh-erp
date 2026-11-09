'use client';

import { PriceChips } from './price-chips';
import type { ProductRow as ProductRowData } from './sourcing-app-client';

export function ProductRow({ product, onClick }: { product: ProductRowData; onClick: () => void }) {
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
        <div className="mt-1">
          <PriceChips prices={product.prices} compact />
        </div>
      </div>
      {product.supplierCount > 0 && (
        <span className="shrink-0 text-xs" style={{ color: 'var(--tg-hint)' }}>
          🏭 {product.supplierCount}
        </span>
      )}
    </button>
  );
}
