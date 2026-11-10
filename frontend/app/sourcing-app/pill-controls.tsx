'use client';

/**
 * Shared "active pill" building blocks (2026-11-11) — `ProductFilterChips`,
 * the Постачальники page's Наші/Можливі segment + region chips, and the
 * home page's Категорії/Виробами segment each used to reimplement the same
 * active/inactive pill styling separately, risking the three drifting
 * apart on any future tweak. One definition, reused everywhere.
 */
export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="shrink-0 rounded-full px-3 py-1 text-xs font-medium"
      style={active ? { background: 'var(--tg-button)', color: 'var(--tg-button-text)' } : { background: 'var(--tg-secondary-bg)', color: 'var(--tg-text)' }}
    >
      {children}
    </button>
  );
}

export function SegmentButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="flex-1 rounded-lg py-2 text-sm font-medium transition-colors"
      style={active ? { background: 'var(--tg-button)', color: 'var(--tg-button-text)' } : { background: 'var(--tg-secondary-bg)', color: 'var(--tg-text)' }}
    >
      {children}
    </button>
  );
}
