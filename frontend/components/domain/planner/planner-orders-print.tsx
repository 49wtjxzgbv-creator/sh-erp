import { useTranslations } from 'next-intl';
import { timelinePercent as percent, timelineMonthMarks as monthMarks } from '@/lib/timeline-utils';
import { cn } from '@/lib/utils';
import type { PlannerOrderNode } from '@/lib/api-client/planner';

/**
 * Print rendition of the "По замовленнях" tab (2026-08-27, redesigned
 * 2026-08-28 — "щоб були видні числа", "весь графік більший"). Same real-
 * `<table>`-with-repeating-`<thead>` approach as PlannerGanttPrintTable
 * (see that file's header comment for why: sticky/absolute divs don't
 * paginate in print media, a `<thead>` genuinely does) — just flat, one row
 * per order, matching the on-screen simplicity instead of the hierarchical
 * order→item→batch→stage nesting that view prints. Each date now gets its
 * own always-visible grid cell (`.planner-print-datesgrid`, globals.css)
 * instead of one crammed text line — same "explicit column, not a
 * squeezed sentence" fix as the on-screen `PlannerOrdersTimelineView`, and
 * risk rows (order.riskLevel) get the same amber/red tint on paper as they
 * do on screen.
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

export function PlannerOrdersPrintTable({ orders, from, to }: { orders: PlannerOrderNode[]; from: Date; to: Date }) {
  const t = useTranslations('planner');
  const ts = useTranslations('sales');
  const months = monthMarks(from, to);
  const sorted = [...orders].sort((a, b) => {
    const aStart = a.plan.startAt ? new Date(a.plan.startAt).getTime() : Infinity;
    const bStart = b.plan.startAt ? new Date(b.plan.startAt).getTime() : Infinity;
    return aStart - bStart || a.clientName.localeCompare(b.clientName);
  });

  return (
    <table className="planner-print-table planner-print-orders-table">
      <colgroup>
        <col style={{ width: '18%' }} />
        <col style={{ width: '32%' }} />
        <col />
      </colgroup>
      <thead>
        <tr>
          <th>{t('ordersTab')}</th>
          <th>
            {ts('plannedStartAt')} · {ts('plannedCompletionAt')} · {ts('plannedShipmentAt')} · {ts('plannedDeliveryAt')} · {ts('deadline')}
          </th>
          <th>
            <div className="relative h-4 w-full">
              {months.map((m, i) => (
                <span key={i} className="absolute top-0 whitespace-nowrap text-[9px] font-semibold" style={{ left: `${percent(m.start, from, to)}%` }}>
                  {m.label}
                </span>
              ))}
            </div>
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
