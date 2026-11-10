'use client';

import type { ProductFilter } from './use-sourcing-app';
import { Chip } from './pill-controls';

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
