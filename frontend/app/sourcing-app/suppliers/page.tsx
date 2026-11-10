'use client';

import { useMemo, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSuppliers, useCandidates, useMe } from '../use-sourcing-app';
import { SupplierCard } from '../supplier-card';
import { CandidateRow } from '../candidate-row';
import { CandidateSheet } from '../candidate-sheet';
import { AddCandidateSheet } from '../add-candidate-sheet';

type Tab = 'real' | 'candidates';

export default function SuppliersPage() {
  const [tab, setTab] = useState<Tab>('real');
  const [region, setRegion] = useState<string | undefined>(undefined);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [showAddCandidate, setShowAddCandidate] = useState(false);

  // Already past the shell's own SDK-readiness gate by the time any page
  // mounts (SourcingAppShell only renders `children` once the Telegram SDK
  // script is loaded) — always-enabled here is safe.
  const { data: me } = useMe(true);
  const { data: realSuppliers, isLoading: loadingReal } = useSuppliers();
  const { data: candidates, isLoading: loadingCandidates } = useCandidates(undefined, region);

  const regions = useMemo(() => {
    if (!candidates) return [];
    return [...new Set(candidates.map((c) => c.region).filter((r): r is string => Boolean(r)))].sort();
  }, [candidates]);

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 flex gap-2 p-3" style={{ background: 'var(--tg-bg)' }}>
        <SegmentButton active={tab === 'real'} onClick={() => setTab('real')}>Наші</SegmentButton>
        <SegmentButton active={tab === 'candidates'} onClick={() => setTab('candidates')}>Можливі</SegmentButton>
      </div>

      {tab === 'candidates' && regions.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-3 pb-2">
          <Chip active={!region} onClick={() => setRegion(undefined)}>Всі</Chip>
          {regions.map((r) => (
            <Chip key={r} active={region === r} onClick={() => setRegion(r)}>{r}</Chip>
          ))}
        </div>
      )}

      {tab === 'candidates' && me?.isAdmin && (
        <div className="px-3 pb-2">
          <Button size="sm" variant="outline" className="w-full" onClick={() => setShowAddCandidate(true)}>
            ➕ Додати постачальника
          </Button>
        </div>
      )}

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {tab === 'real' ? (
          loadingReal ? (
            <>
              <Skeleton className="h-24 w-full rounded-xl" />
              <Skeleton className="h-24 w-full rounded-xl" />
            </>
          ) : !realSuppliers || realSuppliers.length === 0 ? (
            <p className="p-6 text-center text-sm" style={{ color: 'var(--tg-hint)' }}>Жоден постачальник ще не прив&apos;язаний.</p>
          ) : (
            realSuppliers.map((s) => <SupplierCard key={s.id} supplier={s} />)
          )
        ) : loadingCandidates ? (
          <>
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
          </>
        ) : !candidates || candidates.length === 0 ? (
          <p className="p-6 text-center text-sm" style={{ color: 'var(--tg-hint)' }}>Поки немає жодного потенційного постачальника.</p>
        ) : (
          candidates.map((c) => <CandidateRow key={c.id} candidate={c} onClick={() => setSelectedCandidateId(c.id)} />)
        )}
      </div>

      <CandidateSheet candidateId={selectedCandidateId} onClose={() => setSelectedCandidateId(null)} />
      <AddCandidateSheet open={showAddCandidate} onClose={() => setShowAddCandidate(false)} />
    </div>
  );
}

function SegmentButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('flex-1 rounded-lg py-2 text-sm font-medium transition-colors')}
      style={active ? { background: 'var(--tg-button)', color: 'var(--tg-button-text)' } : { background: 'var(--tg-secondary-bg)', color: 'var(--tg-text)' }}
    >
      {children}
    </button>
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
