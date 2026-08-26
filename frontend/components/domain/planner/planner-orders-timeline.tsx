'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { timelineMonthMarks, timelineWeekMarks, timelineDayMarks } from '@/lib/timeline-utils';
import { cn } from '@/lib/utils';
import { px } from './planner-gantt';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { PlannerOrderNode } from '@/lib/api-client/planner';

const ROW_HEIGHT = 92;
const LABEL_WIDTH = 240;
const TOGGLE_WIDTH = 28;
const DATE_COL_WIDTH = 68;
const DATE_FIELDS = ['start', 'completion', 'shipment', 'delivery', 'deadline'] as const;
const DATES_WIDTH = DATE_COL_WIDTH * DATE_FIELDS.length;

function fmtDate(date: Date): string {
  return date.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

const STATUS_BADGE_VARIANT: Record<PlannerOrderNode['status'], 'default' | 'warning' | 'success' | 'destructive'> = {
  NEW: 'default',
  IN_PRODUCTION: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'destructive',
};

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
 * "По замовленнях" (2026-08-27, redesigned 2026-08-28 — "не тільки шкала а
 * весь графік більший", "щоб були видні числа"): every date lives in its
 * own always-visible column (Початок/Заверш./Відванта./Доставка/Термін) —
 * frozen alongside the order-name column via a second `position: sticky`
 * block — instead of being squeezed into hover-only tooltips or a single
 * text line, which read as "approximate" rather than exact. The wide
 * scrollable timeline pane to the right keeps the at-a-glance shape (still
 * one bar + two diamonds + a tick per order, just bigger and with a
 * gradient bar so the period itself reads clearly), for comparing many
 * orders' schedules against each other, not for reading a specific date —
 * that's what the frozen columns are for now.
 */
export function PlannerOrdersTimelineView({ orders, year, onYearChange }: { orders: PlannerOrderNode[]; year: number; onYearChange: (y: number) => void }) {
  const t = useTranslations('planner');
  const ts = useTranslations('sales');
  const [scale, setScale] = useState<OrdersScale>('year');
  const [anchor, setAnchor] = useState(() => new Date());
  // Collapsed by default (2026-08-28 user request) — the frozen date grid
  // is useful but crowds out the timeline the moment this view loads;
  // staff who want it can expand it themselves via the toggle.
  const [datesCollapsed, setDatesCollapsed] = useState(true);
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
  const datesWidth = datesCollapsed ? 0 : DATES_WIDTH;
  const frozenWidth = LABEL_WIDTH + TOGGLE_WIDTH + datesWidth;

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

      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="h-3 w-6 rounded-full bg-[linear-gradient(90deg,hsl(var(--timeline-bar-start)),hsl(var(--timeline-bar-end)))]" />
          {ts('plannedStartAt')} → {ts('plannedCompletionAt')}
        </span>
        <span className="flex items-center gap-2"><span className="h-3 w-3 rotate-45 rounded-sm border border-warning bg-warning/70" />{ts('plannedShipmentAt')}</span>
        <span className="flex items-center gap-2"><span className="h-3 w-3 rotate-45 rounded-sm border border-success bg-success/70" />{ts('plannedDeliveryAt')}</span>
        <span className="flex items-center gap-2"><span className="h-3.5 w-1 rounded-sm bg-destructive" />{ts('deadline')}</span>
        <span className="flex items-center gap-2 text-warning"><span className="h-2.5 w-2.5 rounded-full bg-warning" />{t('riskWarning')}</span>
        <span className="flex items-center gap-2 text-destructive"><span className="h-2.5 w-2.5 rounded-full bg-destructive" />{t('riskCritical')}</span>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <div ref={scrollRef} className="max-h-[75vh] overflow-auto">
          <div className="relative" style={{ width: frozenWidth + canvasWidth }}>
            <div className="sticky top-0 z-20 flex border-b border-border bg-card">
              <div
                className="sticky left-0 z-30 flex shrink-0 items-end border-r border-border bg-card px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                style={{ width: LABEL_WIDTH }}
              >
                {t('ordersTab')}
              </div>
              <button
                type="button"
                onClick={() => setDatesCollapsed((v) => !v)}
                className="sticky z-30 flex shrink-0 items-center justify-center border-r border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground"
                style={{ left: LABEL_WIDTH, width: TOGGLE_WIDTH }}
                title={datesCollapsed ? t('expandDates') : t('collapseDates')}
              >
                {datesCollapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
              </button>
              {!datesCollapsed && (
                <div className="sticky z-30 flex shrink-0 border-r border-border bg-card" style={{ left: LABEL_WIDTH + TOGGLE_WIDTH, width: datesWidth }}>
                  {[t('dateColStart'), t('dateColCompletion'), t('dateColShipment'), t('dateColDelivery'), t('dateColDeadline')].map((label, i) => (
                    <div
                      key={i}
                      className="flex items-end overflow-hidden px-1 pb-2 text-[9px] font-semibold uppercase leading-[1.1] tracking-wide text-muted-foreground"
                      style={{ width: DATE_COL_WIDTH }}
                      title={[ts('plannedStartAt'), ts('plannedCompletionAt'), ts('plannedShipmentAt'), ts('plannedDeliveryAt'), ts('deadline')][i]}
                    >
                      {label}
                    </div>
                  ))}
                </div>
              )}
              <div className="relative shrink-0" style={{ width: canvasWidth, height: scale === 'year' ? 32 : 46 }}>
                {months.map((m, i) => (
                  <span key={i} className="absolute top-2 whitespace-nowrap text-sm font-semibold" style={{ left: px(m.start, viewFrom, pxPerDay) + 6 }}>
                    {m.label}
                  </span>
                ))}
                {scale === 'week' &&
                  days.map((d, i) => (
                    <span key={i} className="absolute top-7 text-xs tabular-nums text-muted-foreground" style={{ left: px(d, viewFrom, pxPerDay) + 3 }}>
                      {d.getDate()}
                    </span>
                  ))}
                {scale === 'month' &&
                  weeks.map((w, i) => (
                    <span key={i} className="absolute top-7 text-xs font-medium tabular-nums text-muted-foreground" style={{ left: px(w, viewFrom, pxPerDay) + 3 }}>
                      {w.getDate()}
                    </span>
                  ))}
              </div>
            </div>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0" style={{ left: frozenWidth, width: canvasWidth }}>
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
                const dateCells = [start, completion, shipment, delivery, deadline];
                const risk = order.riskLevel;
                const rowTint = risk === 'critical' ? 'bg-destructive/10' : risk === 'warning' ? 'bg-warning/10' : i % 2 === 1 ? 'bg-muted/10' : undefined;
                const frozenBg = risk === 'critical' ? 'hsl(var(--destructive) / 0.08)' : risk === 'warning' ? 'hsl(var(--warning) / 0.1)' : i % 2 === 1 ? 'hsl(var(--muted) / 0.3)' : 'hsl(var(--card))';
                return (
                  <div key={order.id} className={cn('relative flex border-b border-border/60', rowTint)} style={{ height: ROW_HEIGHT }}>
                    <Link
                      href={`/sales/${order.id}`}
                      className="sticky left-0 z-10 flex shrink-0 flex-col justify-center gap-1 overflow-hidden border-r border-border px-3 py-2 hover:text-primary"
                      style={{ width: LABEL_WIDTH, backgroundColor: frozenBg }}
                      title={label}
                    >
                      <span className="truncate text-sm font-semibold">{label}</span>
                      <Badge variant={STATUS_BADGE_VARIANT[order.status]} className="w-fit">
                        {ts(`orderStatus${order.status}`)}
                      </Badge>
                      {risk !== 'none' && (
                        <span className={cn('text-[11px] font-semibold', risk === 'critical' ? 'text-destructive' : 'text-warning')}>
                          ▲ {t(risk === 'critical' ? 'riskCritical' : 'riskWarning')}
                        </span>
                      )}
                    </Link>
                    <div className="sticky z-10 flex shrink-0 items-center justify-center border-r border-border" style={{ left: LABEL_WIDTH, width: TOGGLE_WIDTH, backgroundColor: frozenBg }}>
                      {datesCollapsed && risk !== 'none' && (
                        <span className={cn('h-2 w-2 rounded-full', risk === 'critical' ? 'bg-destructive' : 'bg-warning')} title={t(risk === 'critical' ? 'riskCritical' : 'riskWarning')} />
                      )}
                    </div>
                    {!datesCollapsed && (
                      <div className="sticky z-10 flex shrink-0 items-center border-r border-border" style={{ left: LABEL_WIDTH + TOGGLE_WIDTH, width: datesWidth, backgroundColor: frozenBg }}>
                        {DATE_FIELDS.map((field, idx) => {
                          const d = dateCells[idx];
                          const isDeadline = field === 'deadline';
                          return (
                            <div key={field} className="flex items-center px-1" style={{ width: DATE_COL_WIDTH }}>
                              {d ? (
                                <span
                                  className={cn(
                                    'font-mono text-xs font-bold tabular-nums',
                                    isDeadline && risk !== 'none' ? (risk === 'critical' ? 'text-destructive' : 'text-warning') : 'text-foreground',
                                  )}
                                >
                                  {fmtDate(d)}
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div className="relative flex-1">
                      {start && completion && (
                        <div
                          className="absolute top-[35px] h-[18px] rounded-full bg-[linear-gradient(90deg,hsl(var(--timeline-bar-start)),hsl(var(--timeline-bar-end)))] shadow-sm"
                          style={{
                            left: px(start, viewFrom, pxPerDay),
                            width: Math.max(px(completion, viewFrom, pxPerDay) - px(start, viewFrom, pxPerDay), 6),
                          }}
                          title={`${ts('plannedStartAt')}: ${fmtDate(start)} — ${ts('plannedCompletionAt')}: ${fmtDate(completion)}`}
                        />
                      )}
                      {shipment && (
                        <div
                          className="absolute top-8 h-4 w-4 rotate-45 rounded-[3px] border border-warning bg-warning shadow-sm"
                          style={{ left: px(shipment, viewFrom, pxPerDay) - 8 }}
                          title={`${ts('plannedShipmentAt')}: ${fmtDate(shipment)}`}
                        />
                      )}
                      {delivery && (
                        <div
                          className="absolute top-8 h-4 w-4 rotate-45 rounded-[3px] border border-success bg-success shadow-sm"
                          style={{ left: px(delivery, viewFrom, pxPerDay) - 8 }}
                          title={`${ts('plannedDeliveryAt')}: ${fmtDate(delivery)}`}
                        />
                      )}
                      {deadline && (
                        <div
                          className="absolute top-4 w-1 rounded-sm bg-destructive"
                          style={{ left: px(deadline, viewFrom, pxPerDay), height: ROW_HEIGHT - 32 }}
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
