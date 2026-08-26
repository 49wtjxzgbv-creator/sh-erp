import { useTranslations } from 'next-intl';
import { timelinePercent as percent, timelineMonthMarks as monthMarks } from '@/lib/timeline-utils';
import type { PlannerOrderNode } from '@/lib/api-client/planner';

/**
 * Print rendition of the "По замовленнях" tab (2026-08-27 user request —
 * "щоб можна було роздрукувати це і гарно зрозуміло виглядало"). Same real-
 * `<table>`-with-repeating-`<thead>` approach as PlannerGanttPrintTable
 * (see that file's header comment for why: sticky/absolute divs don't
 * paginate in print media, a `<thead>` genuinely does) — just flat, one row
 * per order, matching the on-screen simplicity instead of the hierarchical
 * order→item→batch→stage nesting that view prints.
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
  return <div className="absolute h-[6px] rounded-sm bg-foreground/70" style={{ left: `${left}%`, width: `${width}%`, top: 20 }} />;
}

function MiniMarker({ date, from, to, className }: { date: Date; from: Date; to: Date; className: string }) {
  const left = percent(date, from, to);
  return <div className={`absolute h-[6px] w-[6px] rotate-45 ${className}`} style={{ left: `calc(${left}% - 3px)`, top: 17 }} />;
}

function MiniTick({ date, from, to }: { date: Date; from: Date; to: Date }) {
  const left = percent(date, from, to);
  return <div className="absolute bottom-0 top-3 w-[1.5px] bg-red-600" style={{ left: `${left}%` }} />;
}

function fmtDate(date: Date): string {
  return date.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });
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
    <table className="planner-print-table">
      <colgroup>
        <col style={{ width: '25%' }} />
        <col />
      </colgroup>
      <thead>
        <tr>
          <th>{t('ordersTab')}</th>
          <th>
            <div className="relative h-4 w-full">
              {months.map((m, i) => (
                <span key={i} className="absolute top-0 whitespace-nowrap text-[8px]" style={{ left: `${percent(m.start, from, to)}%` }}>
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
          const datesSummary = [
            start && `${ts('plannedStartAt')}: ${fmtDate(start)}`,
            completion && `${ts('plannedCompletionAt')}: ${fmtDate(completion)}`,
            shipment && `${ts('plannedShipmentAt')}: ${fmtDate(shipment)}`,
            delivery && `${ts('plannedDeliveryAt')}: ${fmtDate(delivery)}`,
            deadline && `${ts('deadline')}: ${fmtDate(deadline)}`,
          ]
            .filter(Boolean)
            .join('  ·  ');
          return (
            <tr key={order.id}>
              <td>
                <strong>{order.clientName}</strong>
                {order.orderNumber ? ` — №${order.orderNumber}` : ''}
                <br />
                <span className="planner-print-muted text-[8px]">{ts(`orderStatus${order.status}`)}</span>
              </td>
              <td className="relative" style={{ height: 34 }}>
                <div className="text-[8px] leading-tight">{datesSummary || '—'}</div>
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
