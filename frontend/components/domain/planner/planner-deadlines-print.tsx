import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { PlannerOrderNode } from '@/lib/api-client/planner';

/**
 * "зроби можливість друкувати всі замовлення у яких є термін виконання
 * щоб це було гарно і приємно виглядало на листі" (2026-11-24): a
 * dedicated, simple one-row-per-order sheet — every order from the
 * current year's board that actually HAS a deadline set, soonest due
 * first, so it doubles as a priority list on the shop floor, not just a
 * printout. Deliberately separate from PlannerOrdersPrintTable (the
 * Gantt calendar print) — that one's dense and calendar-shaped by
 * necessity; this is just a clean list, roomier rows, no grid to
 * compete with (see globals.css's own `.planner-print-deadlines-table`
 * rule for the extra breathing room over the Gantt table's cramped 9px).
 */
function fmtDate(date: Date): string {
  return date.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function PlannerDeadlinesPrintTable({ orders }: { orders: PlannerOrderNode[] }) {
  const t = useTranslations('planner');
  const ts = useTranslations('sales');

  const withDeadline = orders
    .filter((o) => o.deadline !== null)
    .sort((a, b) => new Date(a.deadline as string).getTime() - new Date(b.deadline as string).getTime());

  if (withDeadline.length === 0) {
    return <p className="text-sm text-gray-600">{t('noDeadlines')}</p>;
  }

  return (
    <table className="planner-print-table planner-print-deadlines-table">
      <colgroup>
        <col className="print-index-col" />
        <col />
        <col style={{ width: '14%' }} />
        <col style={{ width: '18%' }} />
        <col style={{ width: '16%' }} />
      </colgroup>
      <thead>
        <tr>
          <th>№</th>
          <th>{ts('clientName')}</th>
          <th>{ts('status')}</th>
          <th>{t('plannedPeriod')}</th>
          <th>{ts('deadline')}</th>
        </tr>
      </thead>
      <tbody>
        {withDeadline.map((order, i) => {
          const start = order.plan.startAt ? new Date(order.plan.startAt) : null;
          const completion = order.plan.completionAt ? new Date(order.plan.completionAt) : null;
          const deadline = new Date(order.deadline as string);
          const risk = order.riskLevel;
          const riskColor = risk === 'critical' ? '#b91c1c' : risk === 'warning' ? '#b45309' : undefined;
          return (
            <tr key={order.id} className={cn(risk === 'critical' && 'planner-print-row-critical', risk === 'warning' && 'planner-print-row-warning')}>
              <td>{i + 1}</td>
              <td>
                <strong>{order.clientName}</strong>
                {order.orderNumber ? ` — №${order.orderNumber}` : ''}
              </td>
              <td>{ts(`orderStatus${order.status}`)}</td>
              <td>{start && completion ? `${fmtDate(start)} – ${fmtDate(completion)}` : '—'}</td>
              <td>
                <strong style={{ color: riskColor }}>{fmtDate(deadline)}</strong>
                {risk !== 'none' && (
                  <>
                    <br />
                    <span style={{ fontSize: 8, color: riskColor }}>▲ {t(risk === 'critical' ? 'riskCritical' : 'riskWarning')}</span>
                  </>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
