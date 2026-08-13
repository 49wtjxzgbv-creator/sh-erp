'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { timelinePercent as percent, timelineMonthMarks as monthMarks } from '@/lib/timeline-utils';
import type { TimelineLine, TimelineStage } from '@/lib/api-client/dashboard';

/**
 * The dashboard's unified operations Gantt — three otherwise-separate
 * lifecycles (purchase orders to suppliers, production, shipments to
 * customers) drawn on one shared timeline so the whole pipeline's state is
 * visible at a glance: what's done, what's actively happening, what's
 * still ahead. Same hand-built percent-positioned-bars technique as
 * production/schedule-timeline.tsx (shared via lib/timeline-utils.ts) —
 * one row per bar's `groupName` (supplier / assembly / customer), sorted
 * alphabetically, month header aligned to the same `from`/`to` range.
 */
const STAGE_COLOR: Record<TimelineStage, string> = {
  planned: 'bg-secondary border-border text-secondary-foreground',
  in_progress: 'bg-warning/20 border-warning text-warning-foreground',
  completed: 'bg-success/20 border-success text-success-foreground',
};

interface Lane {
  key: string;
  name: string;
  items: TimelineLine[];
}

function buildLanes(lines: TimelineLine[]): Lane[] {
  const laneMap = new Map<string, Lane>();
  for (const line of lines) {
    let lane = laneMap.get(line.groupName);
    if (!lane) {
      lane = { key: line.groupName, name: line.groupName, items: [] };
      laneMap.set(line.groupName, lane);
    }
    lane.items.push(line);
  }
  return Array.from(laneMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export interface OperationsTimelineSectionProps {
  title: string;
  lines: TimelineLine[];
  from: Date;
  to: Date;
  emptyLabel: string;
  onItemClick: (id: string) => void;
  /** Month header is only drawn once at the top of the combined chart, by the first section — later sections just line their bars up against the same from/to range. */
  showMonthHeader?: boolean;
}

export function OperationsTimelineSection({ title, lines, from, to, emptyLabel, onItemClick, showMonthHeader }: OperationsTimelineSectionProps) {
  const lanes = useMemo(() => buildLanes(lines), [lines]);
  const months = useMemo(() => monthMarks(from, to), [from, to]);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="overflow-x-auto">
        {/* print:min-w-0 — the fixed 900px min-width exists for on-screen horizontal scrolling; PrintArea forces the page's own 100%-width box (globals.css's @media print block), so keeping the 900px floor there would just get cut off at the paper edge instead of scrolling. */}
        <div className="min-w-[900px] print:min-w-0">
          {showMonthHeader && (
            <div className="relative flex border-b border-border pb-1 pl-40">
              <div className="relative h-5 flex-1">
                {months.map((m, i) => (
                  <span key={i} className="absolute top-0 text-xs text-muted-foreground" style={{ left: `${percent(m.start, from, to)}%` }}>
                    {m.label}
                  </span>
                ))}
              </div>
            </div>
          )}
          {lanes.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{emptyLabel}</p>
          ) : (
            lanes.map((lane) => (
              <div key={lane.key} className="flex items-center border-b border-border last:border-0">
                <div className="w-40 shrink-0 truncate pr-2 text-sm" title={lane.name}>
                  {lane.name}
                </div>
                <div className="relative h-11 flex-1">
                  {lane.items.map((item) => {
                    const left = percent(new Date(item.startAt), from, to);
                    const right = percent(new Date(item.endAt), from, to);
                    const width = Math.max(right - left, 0.5);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        title={item.label}
                        onClick={() => onItemClick(item.id)}
                        className={cn(
                          'absolute top-1 h-9 truncate rounded-md border px-2 text-left text-xs leading-9 hover:opacity-80',
                          STAGE_COLOR[item.stage] ?? 'bg-secondary border-border',
                        )}
                        style={{ left: `${left}%`, width: `${width}%` }}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function OperationsTimelineLegend({ labels }: { labels: Record<TimelineStage, string> }) {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm border border-border bg-secondary" />
        {labels.planned}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm border border-warning bg-warning/20" />
        {labels.in_progress}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm border border-success bg-success/20" />
        {labels.completed}
      </span>
    </div>
  );
}
