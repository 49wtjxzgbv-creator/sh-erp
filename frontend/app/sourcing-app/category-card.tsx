'use client';

import type { SourcingCategorySummary } from './sourcing-app-client';

/** Category code → icon, matching the item clusters each category actually covers (metizy/tube/laser/motors/bearings/gears/t-nuts/turned-parts/frames/belts — see expand-sourcing-catalog.ts on the backend for the full list this mirrors). */
const CATEGORY_ICONS: Record<string, string> = {
  ALL: '🗂️',
  A: '🔩',
  B: '📏',
  V: '⚡',
  G_A: '⚙️',
  G_B: '🛞',
  G_V: '⚙️',
  G_G: '🔧',
  D: '🌀',
  E: '🏗️',
  J: '➿',
};

export function CategoryCard({ category, onClick }: { category: SourcingCategorySummary; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-xl p-3 text-left active:opacity-70"
      style={{ background: 'var(--tg-section-bg)' }}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-xl" style={{ background: 'var(--tg-secondary-bg)' }}>
        {CATEGORY_ICONS[category.code] ?? '📦'}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{category.name}</p>
        <p className="text-xs" style={{ color: 'var(--tg-hint)' }}>{category.productCount} товарів</p>
      </div>
      <span style={{ color: 'var(--tg-hint)' }}>›</span>
    </button>
  );
}
