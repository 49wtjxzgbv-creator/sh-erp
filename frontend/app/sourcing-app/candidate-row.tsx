'use client';

import { StatusPill } from './status-pill';
import type { CandidateSupplier } from './sourcing-app-client';

export function CandidateRow({ candidate, onClick }: { candidate: CandidateSupplier; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-2 rounded-xl p-3 text-left active:opacity-70"
      style={{ background: 'var(--tg-section-bg)' }}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{candidate.name}</p>
        {(candidate.category || candidate.region) && (
          <p className="truncate text-xs" style={{ color: 'var(--tg-hint)' }}>
            {[candidate.category?.name, candidate.region].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>
      <StatusPill status={candidate.status} label={candidate.statusLabel} />
    </button>
  );
}
