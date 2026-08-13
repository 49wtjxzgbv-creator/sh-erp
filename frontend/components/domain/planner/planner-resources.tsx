'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { timelineMonthMarks } from '@/lib/timeline-utils';
import { cn } from '@/lib/utils';
import { px, batchPlanWindow, type Window } from './planner-gantt';
import type { PlannerOrderNode, PlannerProblem } from '@/lib/api-client/planner';

/**
 * §31: resource load view — one row per employee, the same year timeline
 * as the main Gantt, one bar per ProductionOrder batch they're assigned to
 * (ProductionOrderWorker, already returned per batch — no new table, no
 * new endpoint). Double-booking highlight reuses the board's own
 * RESOURCE_DOUBLE_BOOKED problems (planner-conflicts.service.ts), computed
 * once server-side — this view just renders it, never recomputes it.
 */
const ROW_HEIGHT = 30;
const LABEL_WIDTH = 220;
const PX_PER_DAY = 2.4;

interface EmployeeRow {
  employeeId: string;
  employeeName: string;
  batches: { batchId: string; itemLabel: string; window: Window; conflicted: boolean }[];
}

export function PlannerResourcesView({ orders, problems, year }: { orders: PlannerOrderNode[]; problems: PlannerProblem[]; year: number }) {
  const t = useTranslations('planner');
  const viewFrom = useMemo(() => new Date(year, 0, 1), [year]);
  const viewTo = useMemo(() => new Date(year, 11, 31, 23, 59, 59), [year]);
  const months = useMemo(() => timelineMonthMarks(viewFrom, viewTo), [viewFrom, viewTo]);
  const conflictedBatchIds = useMemo(() => new Set(problems.filter((p) => p.code === 'RESOURCE_DOUBLE_BOOKED').map((p) => p.entityId)), [problems]);
  const canvasWidth = Math.max((viewTo.getTime() - viewFrom.getTime()) / 86400000 * PX_PER_DAY, 600);

  const rows = useMemo(() => {
    const byEmployee = new Map<string, EmployeeRow>();
    for (const order of orders) {
      for (const item of order.items) {
        for (const batch of item.batches) {
          const w = batchPlanWindow(batch);
          if (!w) continue;
          for (const worker of batch.workers) {
            const row = byEmployee.get(worker.employeeId) ?? { employeeId: worker.employeeId, employeeName: worker.employeeName, batches: [] };
            row.batches.push({ batchId: batch.id, itemLabel: `${item.assemblyName} × ${batch.unitsPlanned}`, window: w, conflicted: conflictedBatchIds.has(batch.id) });
            byEmployee.set(worker.employeeId, row);
          }
        }
      }
    }
    return Array.from(byEmployee.values()).sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  }, [orders, conflictedBatchIds]);

  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{t('resourcesEmpty')}</p>;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="max-h-[70vh] overflow-auto">
        <div className="relative" style={{ width: LABEL_WIDTH + canvasWidth }}>
          <div className="sticky top-0 z-20 flex border-b border-border bg-card">
            <div className="sticky left-0 z-30 shrink-0 border-r border-border bg-card px-2 pb-1 text-xs font-semibold text-muted-foreground" style={{ width: LABEL_WIDTH }}>
              {t('resourcesTab')} — {year}
            </div>
            <div className="relative shrink-0" style={{ width: canvasWidth, height: 24 }}>
              {months.map((m, i) => (
                <span key={i} className="absolute top-0 text-xs font-medium" style={{ left: px(m.start, viewFrom, PX_PER_DAY) + 4 }}>
                  {m.label}
                </span>
              ))}
            </div>
          </div>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0" style={{ left: LABEL_WIDTH, width: canvasWidth }}>
              {months.map((m, i) => (
                <div key={i} className="absolute inset-y-0 w-px bg-border" style={{ left: px(m.start, viewFrom, PX_PER_DAY) }} />
              ))}
            </div>
            {rows.map((row, i) => (
              <div key={row.employeeId} className={cn('relative flex border-b border-border/60', i % 2 === 1 && 'bg-muted/10')} style={{ height: ROW_HEIGHT }}>
                <div className="sticky left-0 z-10 flex shrink-0 items-center truncate border-r border-border bg-card px-2 text-xs" style={{ width: LABEL_WIDTH, backgroundColor: 'hsl(var(--card))' }}>
                  {row.employeeName}
                </div>
                <div className="relative flex-1">
                  {row.batches.map((b) => {
                    const left = px(b.window.start, viewFrom, PX_PER_DAY);
                    const width = Math.max(px(b.window.end, viewFrom, PX_PER_DAY) - left, 4);
                    return (
                      <Link
                        key={b.batchId}
                        href={`/production/${b.batchId}`}
                        title={b.conflicted ? `${b.itemLabel} — ${t('resourceConflict')}` : b.itemLabel}
                        className={cn('absolute top-1.5 h-4 rounded-r border-l-4', b.conflicted ? 'border-destructive bg-destructive/40' : 'border-secondary-foreground/50 bg-secondary')}
                        style={{ left, width }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
