'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { timelineMonthMarks } from '@/lib/timeline-utils';
import { cn } from '@/lib/utils';
import { px } from './planner-gantt';
import type { PlannerOrderNode } from '@/lib/api-client/planner';

const ROW_HEIGHT = 34;
const LABEL_WIDTH = 220;
const PX_PER_DAY = 2.4;

/**
 * "По замовленнях" (2026-08-27 user request) — one row per CustomerOrder,
 * plotted across a full calendar year by its OWN planning dates
 * (plannedStartAt→plannedCompletionAt as a bar, plannedShipmentAt/
 * plannedDeliveryAt as diamond markers, deadline as a red tick) — every
 * other planner view is keyed off ProductionOrder/stage scheduling
 * instead, so this is the only place these five CustomerOrder fields are
 * visible together on one screen (previously only ever plain text on the
 * order's own detail page, or one bar/one marker buried inside the
 * hierarchical print table). Same year state the Gantt/Resources tabs and
 * "Друк річний план" already share (page.tsx's `year`/`setYear`) — no
 * independent year switcher here, matches PlannerResourcesView's own
 * convention.
 */
export function PlannerOrdersTimelineView({ orders, year }: { orders: PlannerOrderNode[]; year: number }) {
  const t = useTranslations('planner');
  const ts = useTranslations('sales');
  const viewFrom = useMemo(() => new Date(year, 0, 1), [year]);
  const viewTo = useMemo(() => new Date(year, 11, 31, 23, 59, 59), [year]);
  const months = useMemo(() => timelineMonthMarks(viewFrom, viewTo), [viewFrom, viewTo]);
  const now = new Date();
  const showToday = now >= viewFrom && now <= viewTo;
  const canvasWidth = Math.max(((viewTo.getTime() - viewFrom.getTime()) / 86400000) * PX_PER_DAY, 600);

  const rows = useMemo(
    () =>
      [...orders].sort((a, b) => {
        const aStart = a.plan.startAt ? new Date(a.plan.startAt).getTime() : Infinity;
        const bStart = b.plan.startAt ? new Date(b.plan.startAt).getTime() : Infinity;
        return aStart - bStart || a.clientName.localeCompare(b.clientName);
      }),
    [orders],
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm border-l-4 border-secondary-foreground/50 bg-secondary" />{ts('plannedStartAt')} → {ts('plannedCompletionAt')}</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rotate-45 border border-warning bg-warning/60" />{ts('plannedShipmentAt')}</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rotate-45 border border-success bg-success/60" />{ts('plannedDeliveryAt')}</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-0.5 bg-destructive" />{ts('deadline')}</span>
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="max-h-[70vh] overflow-auto">
          <div className="relative" style={{ width: LABEL_WIDTH + canvasWidth }}>
            <div className="sticky top-0 z-20 flex border-b border-border bg-card">
              <div className="sticky left-0 z-30 shrink-0 border-r border-border bg-card px-2 pb-1 text-xs font-semibold text-muted-foreground" style={{ width: LABEL_WIDTH }}>
                {t('ordersTab')} — {year}
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
                {showToday && (
                  <div className="absolute inset-y-0 z-10 w-px bg-primary" style={{ left: px(now, viewFrom, PX_PER_DAY) }}>
                    <span className="absolute -top-0.5 -translate-x-1/2 rounded-b bg-primary px-1 text-[10px] leading-tight text-primary-foreground">
                      {t('today')}
                    </span>
                  </div>
                )}
              </div>
              {rows.map((order, i) => {
                const start = order.plan.startAt ? new Date(order.plan.startAt) : null;
                const completion = order.plan.completionAt ? new Date(order.plan.completionAt) : null;
                const shipment = order.plan.shipmentAt ? new Date(order.plan.shipmentAt) : null;
                const delivery = order.plan.deliveryAt ? new Date(order.plan.deliveryAt) : null;
                const deadline = order.deadline ? new Date(order.deadline) : null;
                const label = `${order.clientName}${order.orderNumber ? ` — № ${order.orderNumber}` : ''}`;
                return (
                  <div key={order.id} className={cn('relative flex border-b border-border/60', i % 2 === 1 && 'bg-muted/10')} style={{ height: ROW_HEIGHT }}>
                    <Link
                      href={`/sales/${order.id}`}
                      className="sticky left-0 z-10 flex shrink-0 items-center truncate border-r border-border bg-card px-2 text-xs hover:text-primary"
                      style={{ width: LABEL_WIDTH, backgroundColor: 'hsl(var(--card))' }}
                      title={label}
                    >
                      {label}
                    </Link>
                    <div className="relative flex-1">
                      {start && completion && (
                        <div
                          className="absolute top-2.5 h-3.5 rounded-r border-l-4 border-secondary-foreground/50 bg-secondary"
                          style={{
                            left: px(start, viewFrom, PX_PER_DAY),
                            width: Math.max(px(completion, viewFrom, PX_PER_DAY) - px(start, viewFrom, PX_PER_DAY), 4),
                          }}
                          title={`${ts('plannedStartAt')} — ${ts('plannedCompletionAt')}`}
                        />
                      )}
                      {shipment && (
                        <div
                          className="absolute top-2 h-2.5 w-2.5 rotate-45 border border-warning bg-warning/60"
                          style={{ left: px(shipment, viewFrom, PX_PER_DAY) - 5 }}
                          title={ts('plannedShipmentAt')}
                        />
                      )}
                      {delivery && (
                        <div
                          className="absolute top-2 h-2.5 w-2.5 rotate-45 border border-success bg-success/60"
                          style={{ left: px(delivery, viewFrom, PX_PER_DAY) - 5 }}
                          title={ts('plannedDeliveryAt')}
                        />
                      )}
                      {deadline && (
                        <div className="absolute inset-y-1 w-0.5 bg-destructive" style={{ left: px(deadline, viewFrom, PX_PER_DAY) }} title={ts('deadline')} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
