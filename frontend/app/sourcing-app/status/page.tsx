'use client';

import { useMemo, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useStatusOverview } from '../use-sourcing-app';
import { StatusPill } from '../status-pill';
import { CandidateSheet } from '../candidate-sheet';
import type { OutreachStatus, StatusOverview } from '../sourcing-app-client';

type StatusItem = StatusOverview['items'][number];

const STATUS_ORDER: OutreachStatus[] = ['NOT_CONTACTED', 'CONTACTED', 'AWAITING_RESPONSE', 'RESPONDED', 'QUOTE_RECEIVED', 'WON', 'REJECTED'];

/** Mirrors sourcing-shared.ts's STATUS_LABELS on the backend — summary pills need a label even for a status with items but no single item object handy to read one off of. */
const STATUS_LABELS: Record<OutreachStatus, string> = {
  NOT_CONTACTED: '⬜ Не написали',
  CONTACTED: '✉️ Написали',
  AWAITING_RESPONSE: '⏳ Чекаємо відповідь',
  RESPONDED: '💬 Відповіли',
  QUOTE_RECEIVED: '💰 Є ціна',
  REJECTED: '❌ Відмовили',
  WON: '🏆 Домовились',
};

export default function StatusPage() {
  const { data, isLoading } = useStatusOverview();
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);

  const byCategory = useMemo(() => {
    const map = new Map<string, StatusItem[]>();
    if (!data) return map;
    for (const item of data.items) {
      map.set(item.categoryName, [...(map.get(item.categoryName) ?? []), item]);
    }
    return map;
  }, [data]);

  if (isLoading || !data) {
    return (
      <div className="space-y-2 p-3">
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-3">
      <div className="flex flex-wrap gap-1.5">
        {STATUS_ORDER.filter((s) => data.counts[s] > 0).map((status) => (
          <StatusPill key={status} status={status} label={`${STATUS_LABELS[status]} · ${data.counts[status]}`} />
        ))}
      </div>

      {[...byCategory.entries()].map(([categoryName, items]) => (
        <section key={categoryName}>
          <p className="mb-1.5 text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>{categoryName}</p>
          <div className="space-y-1.5">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedCandidateId(item.id)}
                className="flex w-full items-center justify-between rounded-lg p-2.5 text-left text-sm active:opacity-70"
                style={{ background: 'var(--tg-section-bg)' }}
              >
                <span>{item.name}</span>
                <StatusPill status={item.status} label={item.statusLabel} />
              </button>
            ))}
          </div>
        </section>
      ))}

      <CandidateSheet candidateId={selectedCandidateId} onClose={() => setSelectedCandidateId(null)} />
    </div>
  );
}
