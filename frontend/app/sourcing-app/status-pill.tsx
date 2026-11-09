'use client';

import type { OutreachStatus } from './sourcing-app-client';

/** Semantic color per status, separate from the Mini App's `--tg-*` accent (research note: semantic color shouldn't double as the brand accent) — green progress toward WON, red for REJECTED, neutral for not-yet-contacted. */
const STATUS_COLORS: Record<OutreachStatus, { bg: string; fg: string }> = {
  NOT_CONTACTED: { bg: '#e5e7eb', fg: '#374151' },
  CONTACTED: { bg: '#dbeafe', fg: '#1e40af' },
  AWAITING_RESPONSE: { bg: '#fef3c7', fg: '#92400e' },
  RESPONDED: { bg: '#e0e7ff', fg: '#3730a3' },
  QUOTE_RECEIVED: { bg: '#d1fae5', fg: '#065f46' },
  REJECTED: { bg: '#fee2e2', fg: '#991b1b' },
  WON: { bg: '#fef08a', fg: '#713f12' },
};

export function StatusPill({ status, label }: { status: OutreachStatus; label: string }) {
  const colors = STATUS_COLORS[status];
  return (
    <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: colors.bg, color: colors.fg }}>
      {label}
    </span>
  );
}
