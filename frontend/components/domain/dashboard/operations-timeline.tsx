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
 * one lane per bar's `groupName` (supplier / assembly / customer), sorted
 * alphabetically, month header aligned to the same `from`/`to` range.
 */
const STAGE_COLOR: Record<TimelineStage, string> = {
  planned: 'bg-secondary border-border text-secondary-foreground',
  in_progress: 'bg-warning/20 border-warning text-warning-foreground',
  completed: 'bg-success/20 border-success text-success-foreground',
};

const ROW_HEIGHT = 30;

interface Lane {
  key: string;
  name: string;
  /** Packed sub-rows within this lane — see packRows(). Most lanes end up with just one; a lane only grows extra sub-rows where its own bars actually overlap in time, so it stays compact except where it genuinely needs the room. */
  rows: TimelineLine[][];
}

/**
 * Greedy interval-scheduling packing: sorts by start date, and places each
 * item in the first existing sub-row whose last item has already ended by
 * the time this one starts, opening a new sub-row only when none fits.
 * Without this, every order for the same supplier/assembly/customer drew
 * on top of each other at an identical vertical position — illegible once
 * there was more than a handful of concurrent orders (reported live: "буде
 * каша" — a real, not hypothetical, readability failure at realistic order
 * volumes, not an edge case).
 */
function packRows(items: TimelineLine[]): TimelineLine[][] {
  const sorted = [...items].sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  const rows: TimelineLine[][] = [];
  for (const item of sorted) {
    const itemStart = new Date(item.startAt).getTime();
    const row = rows.find((r) => new Date(r[r.length - 1].endAt).getTime() <= itemStart);
    if (row) row.push(item);
    else rows.push([item]);
  }
  return rows;
}

function buildLanes(lines: TimelineLine[]): Lane[] {
  const groupMap = new Map<string, TimelineLine[]>();
  for (const line of lines) {
    const arr = groupMap.get(line.groupName);
    if (arr) arr.push(line);
    else groupMap.set(line.groupName, [line]);
  }
  return Array.from(groupMap.entries())
    .map(([name, items]) => ({ key: name, name, rows: packRows(items) }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
          {/* max-h + overflow-y-auto — a section with many lanes (e.g. dozens of suppliers) would otherwise push the rest of the dashboard far down the page; scoped scrolling keeps the section itself navigable. Lifted for print (print:max-h-none/overflow-visible) since a printed page has no scrollbar — the whole thing should just flow onto as many pages as it needs. */}
          {lanes.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{emptyLabel}</p>
          ) : (
            <div className="max-h-[420px] overflow-y-auto print:max-h-none print:overflow-visible">
              {lanes.map((lane) => (
                <div key={lane.key} className="flex border-b border-border last:border-0">
                  <div
                    className="flex w-40 shrink-0 items-center truncate pr-2 text-sm"
                    style={{ height: lane.rows.length * ROW_HEIGHT }}
                    title={lane.name}
                  >
                    {lane.name}
                  </div>
                  <div className="relative flex-1" style={{ height: lane.rows.length * ROW_HEIGHT }}>
                    {lane.rows.map((row, rowIndex) =>
                      row.map((item) => {
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
                              'absolute h-6 truncate rounded border px-1.5 text-left text-xs leading-6 hover:opacity-80',
                              STAGE_COLOR[item.stage] ?? 'bg-secondary border-border',
                            )}
                            style={{ left: `${left}%`, width: `${width}%`, top: rowIndex * ROW_HEIGHT + 2 }}
                          >
                            {item.label}
                          </button>
                        );
                      }),
                    )}
                  </div>
                </div>
              ))}
            </div>
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
