import { useTranslations } from 'next-intl';
import { timelinePercent as percent, timelineMonthMarks as monthMarks, timelineWeekMarks as weekMarks, timelineDayMarks as dayMarks } from '@/lib/timeline-utils';
import { cn } from '@/lib/utils';
import type { PlannerOrderNode } from '@/lib/api-client/planner';

/**
 * Print rendition of the "По замовленнях" tab (2026-08-27, redesigned
 * 2026-08-28 twice — "щоб були видні числа", "весь графік більший", then
 * "при друці не видно числ днів... щоб можна було приховувати блок...
 * зроби меншим"). Same real-`<table>`-with-repeating-`<thead>` approach as
 * PlannerGanttPrintTable (see that file's header comment for why:
 * sticky/absolute divs don't paginate in print media, a `<thead>` genuinely
 * does) — just flat, one row per order, matching the on-screen simplicity
 * instead of the hierarchical order→item→batch→stage nesting that view
 * prints.
 *
 * `scale` drives a second calendar-header line, same as the on-screen
 * timeline: day-of-month numbers under each day (week scale) or week-start
 * (month scale) gridline — year scale stays month-labels-only, numbering
 * ~365 individual days at that density would be unreadable. `datesHidden`
 * mirrors the on-screen collapse toggle (`PlannerOrdersTimelineView`) —
 * print has no "expand it back" affordance mid-page, so this is a plain
 * show/hide decided once, before printing, not a live toggle on the page.
 */
function MonthGrid({ from, to, months }: { from: Date; to: Date; months: { start: Date }[] }) {
  return (
    <>
      {months.map((m, i) => (
        <div key={i} className="planner-print-gridline" style={{ left: `${percent(m.start, from, to)}%` }} />
      ))}
    </>
  );
}

function MiniBar({ start, end, from, to }: { start: Date; end: Date; from: Date; to: Date }) {
  const left = percent(start, from, to);
  const width = Math.max(percent(end, from, to) - left, 0.6);
  return (
    <div
      className="absolute rounded-sm"
      style={{ left: `${left}%`, width: `${width}%`, top: 26, height: 10, background: 'linear-gradient(90deg, #ddd0f6, #6423d0)' }}
    />
  );
}

function MiniMarker({ date, from, to, className }: { date: Date; from: Date; to: Date; className: string }) {
  const left = percent(date, from, to);
  return <div className={`absolute h-[10px] w-[10px] rotate-45 ${className}`} style={{ left: `calc(${left}% - 5px)`, top: 24 }} />;
}

function MiniTick({ date, from, to }: { date: Date; from: Date; to: Date }) {
  const left = percent(date, from, to);
  return <div className="absolute bottom-1 top-4 w-[2px] bg-red-600" style={{ left: `${left}%` }} />;
}

function fmtDate(date: Date): string {
  return date.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/**
 * Visual key for the print table's own markers (2026-08-28 user request —
 * "щоб були написані пояснення до позначок що що означає ромб такий те
 * червона лінія те"): the on-screen view explains itself via colored swatch
 * + label pairs right above the table (PlannerOrdersTimelineView's own
 * legend row); the print output only ever had a bare text list of field
 * names, no colors — so a reader with just the paper in hand had no way to
 * decode which shape meant what. Swatch colors are hardcoded to match
 * MiniBar/MiniMarker/MiniTick exactly (same amber-500/emerald-600/red-600/
 * gradient), not sourced from CSS custom properties — print output must
 * stay legible regardless of the viewer's on-screen theme.
 */
export function PlannerOrdersPrintLegend() {
  const ts = useTranslations('sales');
  const t = useTranslations('planner');
  return (
    <div className="flex flex-wrap items-center gap-3 text-[8px]">
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-[6px] w-4 rounded-sm" style={{ background: 'linear-gradient(90deg, #ddd0f6, #6423d0)' }} />
        {ts('plannedStartAt')} → {ts('plannedCompletionAt')}
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-[7px] w-[7px] rotate-45 bg-amber-500" />
        {ts('plannedShipmentAt')}
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-[7px] w-[7px] rotate-45 bg-emerald-600" />
        {ts('plannedDeliveryAt')}
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-[10px] w-[2px] bg-red-600" />
        {ts('deadline')}
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-[10px] w-[10px] border border-amber-600" style={{ background: '#fdf1dc' }} />
        {t('riskWarning')}
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-[10px] w-[10px] border border-red-700" style={{ background: '#fbe6e6' }} />
        {t('riskCritical')}
      </span>
    </div>
  );
}

export function PlannerOrdersPrintTable({
  orders,
  from,
  to,
  scale = 'year',
  datesHidden = false,
}: {
  orders: PlannerOrderNode[];
  from: Date;
  to: Date;
  scale?: 'week' | 'month' | 'year';
  datesHidden?: boolean;
}) {
  const t = useTranslations('planner');
  const ts = useTranslations('sales');
  const months = monthMarks(from, to);
  const days = scale === 'week' ? dayMarks(from, to) : [];
  const weeks = scale === 'month' ? weekMarks(from, to) : [];
  const sorted = [...orders].sort((a, b) => {
    const aStart = a.plan.startAt ? new Date(a.plan.startAt).getTime() : Infinity;
    const bStart = b.plan.startAt ? new Date(b.plan.startAt).getTime() : Infinity;
    return aStart - bStart || a.clientName.localeCompare(b.clientName);
  });

  return (
    <table className="planner-print-table planner-print-orders-table">
      <colgroup>
        <col style={{ width: '16%' }} />
        {!datesHidden && <col style={{ width: '20%' }} />}
        <col />
      </colgroup>
      <thead>
        <tr>
          <th>{t('ordersTab')}</th>
          {!datesHidden && (
            <th className="text-[8px]">
              {ts('plannedStartAt')} · {ts('plannedCompletionAt')} · {ts('plannedShipmentAt')} · {ts('plannedDeliveryAt')} · {ts('deadline')}
            </th>
          )}
          <th>
            <div className="relative h-4 w-full">
              {months.map((m, i) => (
                <span key={i} className="absolute top-0 whitespace-nowrap text-[9px] font-semibold" style={{ left: `${percent(m.start, from, to)}%` }}>
                  {m.label}
                </span>
              ))}
            </div>
            {scale !== 'year' && (
              <div className="relative h-3 w-full">
                {days.map((d, i) => (
                  <span key={i} className="absolute top-0 text-[7px]" style={{ left: `${percent(d, from, to)}%` }}>
                    {d.getDate()}
                  </span>
                ))}
                {weeks.map((w, i) => (
                  <span key={i} className="absolute top-0 font-medium text-[7px]" style={{ left: `${percent(w, from, to)}%` }}>
                    {w.getDate()}
                  </span>
                ))}
              </div>
            )}
          </th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((order) => {
          const start = order.plan.startAt ? new Date(order.plan.startAt) : null;
          const completion = order.plan.completionAt ? new Date(order.plan.completionAt) : null;
          const shipment = order.plan.shipmentAt ? new Date(order.plan.shipmentAt) : null;
          const delivery = order.plan.deliveryAt ? new Date(order.plan.deliveryAt) : null;
          const deadline = order.deadline ? new Date(order.deadline) : null;
          const risk = order.riskLevel;
          return (
            <tr key={order.id} className={cn(risk === 'critical' && 'planner-print-row-critical', risk === 'warning' && 'planner-print-row-warning')}>
              <td>
                <strong>{order.clientName}</strong>
                {order.orderNumber ? ` — №${order.orderNumber}` : ''}
                <br />
                <span className="planner-print-muted">{ts(`orderStatus${order.status}`)}</span>
                {risk !== 'none' && (
                  <>
                    <br />
                    <span style={{ color: risk === 'critical' ? '#b91c1c' : '#b45309', fontWeight: 700 }}>▲ {t(risk === 'critical' ? 'riskCritical' : 'riskWarning')}</span>
                  </>
                )}
              </td>
              {!datesHidden && (
                <td>
                  <div className="planner-print-datesgrid">
                    <div><span className="k">{ts('plannedStartAt')}</span><span className="v">{start ? fmtDate(start) : '—'}</span></div>
                    <div><span className="k">{ts('plannedCompletionAt')}</span><span className="v">{completion ? fmtDate(completion) : '—'}</span></div>
                    <div><span className="k">{ts('plannedShipmentAt')}</span><span className="v">{shipment ? fmtDate(shipment) : '—'}</span></div>
                    <div><span className="k">{ts('plannedDeliveryAt')}</span><span className="v">{delivery ? fmtDate(delivery) : '—'}</span></div>
                    <div>
                      <span className="k">{ts('deadline')}</span>
                      <span className="v" style={{ color: risk !== 'none' ? (risk === 'critical' ? '#b91c1c' : '#b45309') : undefined }}>
                        {deadline ? fmtDate(deadline) : '—'}
                      </span>
                    </div>
                  </div>
                </td>
              )}
              <td className="relative" style={{ height: 44 }}>
                <MonthGrid from={from} to={to} months={months} />
                {start && completion && <MiniBar start={start} end={completion} from={from} to={to} />}
                {shipment && <MiniMarker date={shipment} from={from} to={to} className="bg-amber-500" />}
                {delivery && <MiniMarker date={delivery} from={from} to={to} className="bg-emerald-600" />}
                {deadline && <MiniTick date={deadline} from={from} to={to} />}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
