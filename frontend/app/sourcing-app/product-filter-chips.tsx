'use client';

import type { ProductFilter } from './use-sourcing-app';

/** "фільтри в списку товарів — лише без жодного постачальника / лише без ціни" (2026-11-10) — single-select, same chip-row pattern the region filter on Постачальники/Можливі already uses. */
export function ProductFilterChips({ value, onChange }: { value: ProductFilter; onChange: (next: ProductFilter) => void }) {
  return (
    <div className="flex gap-2 overflow-x-auto">
      <Chip active={!value} onClick={() => onChange(undefined)}>Всі</Chip>
      <Chip active={value === 'noSupplier'} onClick={() => onChange('noSupplier')}>Без постачальника</Chip>
      <Chip active={value === 'noPrice'} onClick={() => onChange('noPrice')}>Без ціни</Chip>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded-full px-3 py-1 text-xs font-medium"
      style={active ? { background: 'var(--tg-button)', color: 'var(--tg-button-text)' } : { background: 'var(--tg-secondary-bg)', color: 'var(--tg-text)' }}
    >
      {children}
    </button>
  );
}
