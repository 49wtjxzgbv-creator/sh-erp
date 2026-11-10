'use client';

import type { AssemblySummary } from './sourcing-app-client';

export function AssemblyCard({ assembly, onClick }: { assembly: AssemblySummary; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-xl p-3 text-left active:opacity-70"
      style={{ background: 'var(--tg-section-bg)' }}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg text-xl" style={{ background: 'var(--tg-secondary-bg)' }}>
        {assembly.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL
          <img src={assembly.photoUrl} alt={assembly.name} className="h-full w-full object-contain" />
        ) : (
          '🏭'
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{assembly.name}</p>
        <p className="text-xs" style={{ color: 'var(--tg-hint)' }}>
          {assembly.article ? `${assembly.article} · ` : ''}{assembly.componentCount} компонентів
        </p>
      </div>
      <span style={{ color: 'var(--tg-hint)' }}>›</span>
    </button>
  );
}
