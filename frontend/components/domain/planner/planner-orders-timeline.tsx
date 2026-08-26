'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronRight } from 'lucide-react';
import { timelineMonthMarks, timelineWeekMarks, timelineDayMarks } from '@/lib/timeline-utils';
import { cn } from '@/lib/utils';
import { px } from './planner-gantt';
import { Button } from '@/components/ui/button';
import type { PlannerOrderNode } from '@/lib/api-client/planner';

const ROW_HEIGHT = 46;
const LABEL_WIDTH = 220;

function fmtDate(date: Date): string {
  return date.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

type OrdersScale = 'week' | 'month' | 'year';
const SCALES: OrdersScale[] = ['week', 'month', 'year'];
/** Same base px/day as PlannerGanttChart's own week/month scales (BASE_PX_PER_DAY) — familiar zoom level across the module. */
const PX_PER_DAY: Record<OrdersScale, number> = { week: 34, month: 11, year: 2.4 };
/**
 * Window/pan sizing for week and month scale (2026-08-27 fix — "прокрут
 * продовжувався на наступний місяць а не обмежувався одним"): the visible
 * canvas is NOT bounded to exactly the current week/month any more, same
 * as PlannerGanttChart's own non-year scales (WINDOW_DAYS/PAN_STEP_DAYS) —
 * it's a wide window (~3 months at week scale, ~14 months at month scale)
 * centered on `anchor`, so dragging/wheeling the scrollbar keeps revealing
 * further weeks/months on its own; the prev/next buttons and "Сьогодні"
 * just re-center the same continuous canvas, they don't swap to an
 * isolated new one.
 */
const WINDOW_DAYS: Record<'week' | 'month', number> = { week: 90, month: 420 };
const PAN_STEP_DAYS: Record<'week' | 'month', number> = { week: 7, month: 30 };

/**
 * "По замовленнях" (2026-08-27 user request) — one row per CustomerOrder,
 * plotted by its OWN planning dates (plannedStartAt→plannedCompletionAt as
 * a bar, plannedShipmentAt/plannedDeliveryAt as diamond markers, deadline
 * as a red tick). Originally year-only; scale switching added same day
 * ("не тільки на цілий рік а й менше тиждень місяць") — week/month use a
 * local `anchor` panned independently of the page's shared `year` state,
 * year scale still drives (and is driven by) that shared state so it stays
 * in lockstep with "Друк річний план" and the Gantt/Resources tabs, same
 * convention PlannerGanttChart's own year scale already follows.
 */
export function PlannerOrdersTimelineView({ orders, year, onYearChange }: { orders: PlannerOrderNode[]; year: number; onYearChange: (y: number) => void }) {
  const t = useTranslations('planner');
  const ts = useTranslations('sales');
  const [scale, setScale] = useState<OrdersScale>('year');
  const [anchor, setAnchor] = useState(() => new Date());
  const scrollRef = useRef<HTMLDivElement>(null);
  const now = useMemo(() => new Date(), []);

  const { viewFrom, viewTo } = useMemo(() => {
    if (scale === 'year') return { viewFrom: new Date(year, 0, 1), viewTo: new Date(year, 11, 31, 23, 59, 59) };
    const windowDays = WINDOW_DAYS[scale];
    return { viewFrom: new Date(anchor.getTime() - (windowDays / 2) * 86400000), viewTo: new Date(anchor.getTime() + (windowDays / 2) * 86400000) };
  }, [scale, year, anchor]);

  const pxPerDay = PX_PER_DAY[scale];
  const months = useMemo(() => timelineMonthMarks(viewFrom, viewTo), [viewFrom, viewTo]);
  const weeks = useMemo(() => (scale === 'month' ? timelineWeekMarks(viewFrom, viewTo) : []), [scale, viewFrom, viewTo]);
  const days = useMemo(() => (scale === 'week' ? timelineDayMarks(viewFrom, viewTo) : []), [scale, viewFrom, viewTo]);
  const showToday = now >= viewFrom && now <= viewTo;
  const canvasWidth = Math.max(((viewTo.getTime() - viewFrom.getTime()) / 86400000) * pxPerDay, 600);

  const rangeLabel = useMemo(() => {
    if (scale === 'year') return String(year);
    if (scale === 'month') return anchor.toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' });
    return anchor.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
  }, [scale, year, anchor]);

  function scrollToDate(date: Date) {
    const container = scrollRef.current;
    if (!container) return;
    const offset = px(date, viewFrom, pxPerDay);
    container.scrollTo({ left: Math.max(offset - container.clientWidth / 2, 0), behavior: 'smooth' });
  }

  // Re-center on the anchor whenever the scale (or, at year scale, the
  // year) changes — otherwise switching into week/month would start
  // scrolled to the far-left edge of the wide window (~1.5/7 months in the
  // past), not at today/the last-panned date.
  useEffect(() => {
    scrollToDate(scale === 'year' ? (year === now.getFullYear() ? now : new Date(year, 0, 1)) : anchor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, year]);

  function pan(dir: 1 | -1) {
    if (scale === 'year') onYearChange(year + dir);
    else setAnchor(new Date(anchor.getTime() + dir * PAN_STEP_DAYS[scale] * 86400000));
  }
  function goToday() {
    setAnchor(now);
    if (scale === 'year') onYearChange(now.getFullYear());
    else scrollToDate(now);
  }

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
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => pan(-1)} title={t('prevPeriod')}>
            <ChevronRight className="h-4 w-4 rotate-180" />
          </Button>
          <span className="min-w-[9rem] text-center text-sm font-semibold capitalize">{rangeLabel}</span>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => pan(1)} title={t('nextPeriod')}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={goToday}>
            {t('todayButton')}
          </Button>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
          {SCALES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScale(s)}
              className={cn('rounded px-2 py-1 text-xs font-medium', scale === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary')}
            >
              {t(`scale${s[0].toUpperCase()}${s.slice(1)}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm border-l-4 border-secondary-foreground/50 bg-secondary" />{ts('plannedStartAt')} → {ts('plannedCompletionAt')}</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rotate-45 border border-warning bg-warning/60" />{ts('plannedShipmentAt')}</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rotate-45 border border-success bg-success/60" />{ts('plannedDeliveryAt')}</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-0.5 bg-destructive" />{ts('deadline')}</span>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <div ref={scrollRef} className="max-h-[70vh] overflow-auto">
          <div className="relative" style={{ width: LABEL_WIDTH + canvasWidth }}>
            <div className="sticky top-0 z-20 flex border-b border-border bg-card">
              <div className="sticky left-0 z-30 shrink-0 border-r border-border bg-card px-2 pb-1 text-xs font-semibold text-muted-foreground" style={{ width: LABEL_WIDTH }}>
                {t('ordersTab')}
              </div>
              <div className="relative shrink-0" style={{ width: canvasWidth, height: 24 }}>
                {months.map((m, i) => (
                  <span key={i} className="absolute top-0 whitespace-nowrap text-xs font-medium" style={{ left: px(m.start, viewFrom, pxPerDay) + 4 }}>
                    {m.label}
                  </span>
                ))}
              </div>
            </div>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0" style={{ left: LABEL_WIDTH, width: canvasWidth }}>
                {scale === 'week' &&
                  days.map((d, i) => <div key={i} className="absolute inset-y-0 w-px bg-border/40" style={{ left: px(d, viewFrom, pxPerDay) }} />)}
                {scale === 'month' &&
                  weeks.map((w, i) => <div key={i} className="absolute inset-y-0 w-px bg-border/40" style={{ left: px(w, viewFrom, pxPerDay) }} />)}
                {months.map((m, i) => (
                  <div key={i} className="absolute inset-y-0 w-px bg-border" style={{ left: px(m.start, viewFrom, pxPerDay) }} />
                ))}
                {showToday && (
                  <div className="absolute inset-y-0 z-10 w-px bg-primary" style={{ left: px(now, viewFrom, pxPerDay) }}>
                    <span className="absolute -top-0.5 -translate-x-1/2 rounded-b bg-primary px-1 text-[10px] leading-tight text-primary-foreground">
                      {t('todayButton')}
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
                const datesSummary = [
                  start && `${ts('plannedStartAt')}: ${fmtDate(start)}`,
                  completion && `${ts('plannedCompletionAt')}: ${fmtDate(completion)}`,
                  shipment && `${ts('plannedShipmentAt')}: ${fmtDate(shipment)}`,
                  delivery && `${ts('plannedDeliveryAt')}: ${fmtDate(delivery)}`,
                  deadline && `${ts('deadline')}: ${fmtDate(deadline)}`,
                ]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <div key={order.id} className={cn('relative flex border-b border-border/60', i % 2 === 1 && 'bg-muted/10')} style={{ height: ROW_HEIGHT }}>
                    <Link
                      href={`/sales/${order.id}`}
                      className="sticky left-0 z-10 flex shrink-0 flex-col justify-center gap-0.5 overflow-hidden border-r border-border bg-card px-2 py-1 text-xs hover:text-primary"
                      style={{ width: LABEL_WIDTH, backgroundColor: 'hsl(var(--card))' }}
                      title={datesSummary ? `${label}\n${datesSummary}` : label}
                    >
                      <span className="truncate">{label}</span>
                      {datesSummary && <span className="truncate text-[10px] text-muted-foreground">{datesSummary}</span>}
                    </Link>
                    <div className="relative flex-1">
                      {start && completion && (
                        <div
                          className="absolute top-4 h-3.5 rounded-r border-l-4 border-secondary-foreground/50 bg-secondary"
                          style={{
                            left: px(start, viewFrom, pxPerDay),
                            width: Math.max(px(completion, viewFrom, pxPerDay) - px(start, viewFrom, pxPerDay), 4),
                          }}
                          title={`${ts('plannedStartAt')}: ${fmtDate(start)} — ${ts('plannedCompletionAt')}: ${fmtDate(completion)}`}
                        />
                      )}
                      {shipment && (
                        <div
                          className="absolute top-3.5 h-2.5 w-2.5 rotate-45 border border-warning bg-warning/60"
                          style={{ left: px(shipment, viewFrom, pxPerDay) - 5 }}
                          title={`${ts('plannedShipmentAt')}: ${fmtDate(shipment)}`}
                        />
                      )}
                      {delivery && (
                        <div
                          className="absolute top-3.5 h-2.5 w-2.5 rotate-45 border border-success bg-success/60"
                          style={{ left: px(delivery, viewFrom, pxPerDay) - 5 }}
                          title={`${ts('plannedDeliveryAt')}: ${fmtDate(delivery)}`}
                        />
                      )}
                      {deadline && (
                        <div
                          className="absolute inset-y-2 w-0.5 bg-destructive"
                          style={{ left: px(deadline, viewFrom, pxPerDay) }}
                          title={`${ts('deadline')}: ${fmtDate(deadline)}`}
                        />
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
