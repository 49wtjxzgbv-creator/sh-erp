'use client';

import { formatEur } from '@/lib/utils';
import type { PriceEntry } from './sourcing-app-client';

/** Same 🇩🇪/🇺🇦/💰 icon language the chat bot already uses (sourcing-shared.ts on the backend) — kept visually consistent between the two surfaces. */
export function PriceChips({ prices, compact = false }: { prices: PriceEntry[]; compact?: boolean }) {
  if (prices.length === 0) {
    return <span className="text-xs" style={{ color: 'var(--tg-hint)' }}>немає цін</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {prices.map((p) => (
        <span
          key={p.field}
          className={compact ? 'rounded-full px-2 py-0.5 text-[11px] font-medium' : 'rounded-md px-2 py-1 text-xs font-medium'}
          style={{ background: 'var(--tg-secondary-bg)', color: 'var(--tg-text)' }}
        >
          {p.icon} {compact ? formatEur(p.value) : `${p.label}: ${formatEur(p.value)}`}
        </span>
      ))}
    </div>
  );
}
