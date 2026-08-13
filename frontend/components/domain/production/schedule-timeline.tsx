'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { ScheduledOrderLine, ScheduleSlotLine } from '@/lib/api-client/production';

/**
 * Hand-built timeline — no calendar/Gantt library in this project
 * (checked: no react-big-calendar, no date-fns, nothing), and the actual
 * need (bars over a date range, one lane per assembly) doesn't warrant
 * pulling one in. Same judgment call as the DXF viewer earlier this
 * session: a focused custom visualization instead of a general-purpose
 * dependency. Pure CSS — month header and every bar are positioned via
 * `left`/`width` percentages computed from the same `from`/`to` range, so
 * they always line up regardless of how many days are in a given month.
 */
export interface ScheduleTimelineProps {
  orders: ScheduledOrderLine[];
  slots: ScheduleSlotLine[];
  from: Date;
  to: Date;
  onOrderClick: (id: string) => void;
  onSlotClick: (slot: ScheduleSlotLine) => void;
}

interface LaneItem {
  kind: 'order' | 'slot';
  id: string;
  label: string;
  start: Date;
  end: Date;
  status?: string;
}

interface Lane {
  key: string;
  name: string | null;
  items: LaneItem[];
}

const STATUS_COLOR: Record<string, string> = {
  PLANNED: 'bg-secondary border-border text-secondary-foreground',
  IN_PROGRESS: 'bg-warning/20 border-warning text-warning-foreground',
  COMPLETED: 'bg-success/20 border-success text-success-foreground',
};

function percent(date: Date, from: Date, to: Date): number {
  const total = to.getTime() - from.getTime();
  if (total <= 0) return 0;
  const clamped = Math.min(Math.max(date.getTime(), from.getTime()), to.getTime());
  return ((clamped - from.getTime()) / total) * 100;
}

function buildLanes(orders: ScheduledOrderLine[], slots: ScheduleSlotLine[]): Lane[] {
  const laneMap = new Map<string, Lane>();

  function laneFor(name: string | null): Lane {
    const key = name ?? '__unassigned';
    let lane = laneMap.get(key);
    if (!lane) {
      lane = { key, name, items: [] };
      laneMap.set(key, lane);
    }
    return lane;
  }

  for (const o of orders) {
    laneFor(o.assemblyName).items.push({
      kind: 'order',
      id: o.id,
      label: `${o.assemblyName} (${o.unitsPlanned})`,
      start: new Date(o.scheduledStartAt),
      end: new Date(o.scheduledEndAt),
      status: o.status,
    });
  }
  for (const s of slots) {
    laneFor(s.assemblyName).items.push({
      kind: 'slot',
      id: s.id,
      label: s.title,
      start: new Date(s.startAt),
      end: new Date(s.endAt),
    });
  }

  return Array.from(laneMap.values()).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
}

function monthMarks(from: Date, to: Date): { label: string; start: Date }[] {
  const marks: { label: string; start: Date }[] = [];
  let cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  let guard = 0;
  while (cursor <= to && guard < 36) {
    marks.push({ label: cursor.toLocaleDateString('uk-UA', { month: 'short' }), start: new Date(cursor) });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    guard += 1;
  }
  return marks;
}

export function ScheduleTimeline({ orders, slots, from, to, onOrderClick, onSlotClick }: ScheduleTimelineProps) {
  const t = useTranslations('production');
  const lanes = useMemo(() => buildLanes(orders, slots), [orders, slots]);
  const months = useMemo(() => monthMarks(from, to), [from, to]);

  if (lanes.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{t('scheduleEmpty')}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[900px]">
        <div className="relative flex border-b border-border pb-1 pl-40">
          <div className="relative h-5 flex-1">
            {months.map((m, i) => (
              <span
                key={i}
                className="absolute top-0 text-xs text-muted-foreground"
                style={{ left: `${percent(m.start, from, to)}%` }}
              >
                {m.label}
              </span>
            ))}
          </div>
        </div>

        {lanes.map((lane) => (
          <div key={lane.key} className="flex items-center border-b border-border last:border-0">
            <div className="w-40 shrink-0 truncate pr-2 text-sm" title={lane.name ?? t('noAssembly')}>
              {lane.name ?? t('noAssembly')}
            </div>
            <div className="relative h-11 flex-1">
              {lane.items.map((item) => {
                const left = percent(item.start, from, to);
                const right = percent(item.end, from, to);
                const width = Math.max(right - left, 0.5);
                const isSlot = item.kind === 'slot';
                return (
                  <button
                    key={`${item.kind}-${item.id}`}
                    type="button"
                    title={item.label}
                    onClick={() => (isSlot ? onSlotClick(slots.find((s) => s.id === item.id)!) : onOrderClick(item.id))}
                    className={cn(
                      'absolute top-1 h-9 truncate rounded-md border px-2 text-left text-xs leading-9 hover:opacity-80',
                      isSlot ? 'border-dashed border-muted-foreground bg-muted text-muted-foreground' : STATUS_COLOR[item.status ?? ''] ?? 'bg-secondary border-border',
                    )}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
