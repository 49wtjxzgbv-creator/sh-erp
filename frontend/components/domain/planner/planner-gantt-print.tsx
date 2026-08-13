import { useTranslations } from 'next-intl';
import { timelinePercent as percent, timelineMonthMarks as monthMarks } from '@/lib/timeline-utils';
import { cn } from '@/lib/utils';
import type { PlannerBatchNode, PlannerItemNode, PlannerOrderNode } from '@/lib/api-client/planner';

/**
 * Print rendition of the План-графік — deliberately a real `<table>` with a
 * repeating `<thead>`, not a printed screenshot of the interactive
 * absolute-positioned canvas. Sticky-positioned divs don't paginate in
 * print media at all (there's no scroll context on paper), but a
 * `<thead>` row genuinely repeats on every printed page in every major
 * browser — the one reliable mechanism for "timeline header repeats per
 * page" on paper. Each row still carries a real percent-positioned
 * plan/fact bar (scoped to that row's own cell, so it paginates with its
 * row like any other table content) — this is the standard, robust way
 * production/scheduling software renders a Gantt to paper.
 *
 * Column widths: the timeline needs to actually be able to show a whole
 * year — a full year of month labels crammed into a narrow text column
 * (alongside separate ever-present "План"/"Факт" text columns) smears
 * into unreadable overlapping text (real bug, fixed here). Plan/fact
 * dates are now a compact line under the row's own label instead of
 * their own columns, so the timeline gets the width it actually needs.
 * Always fully expanded (a printed dispatcher document has no
 * "collapsed" state).
 */
export function PlannerGanttPrintTable({ orders, photoByAssembly, from, to }: { orders: PlannerOrderNode[]; photoByAssembly: Record<string, string | undefined>; from: Date; to: Date }) {
  const t = useTranslations('planner');
  const ts = useTranslations('sales');
  const tp = useTranslations('production');
  const months = monthMarks(from, to);

  return (
    <table className="planner-print-table">
      <colgroup>
        <col style={{ width: '30%' }} />
        <col style={{ width: '9%' }} />
        <col />
      </colgroup>
      <thead>
        <tr>
          <th>{t('printColHierarchy')}</th>
          <th>{t('printColStatus')}</th>
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
        {orders.map((order) => (
          <PrintOrderRows key={order.id} order={order} photoByAssembly={photoByAssembly} from={from} to={to} t={t} ts={ts} tp={tp} months={months} />
        ))}
      </tbody>
    </table>
  );
}

function MonthGrid({ from, to, months }: { from: Date; to: Date; months: { start: Date }[] }) {
  return (
    <>
      {months.map((m, i) => (
        <div key={i} className="planner-print-gridline" style={{ left: `${percent(m.start, from, to)}%` }} />
      ))}
    </>
  );
}

function MiniBar({ start, end, from, to, top, className, label }: { start: Date; end: Date; from: Date; to: Date; top: number; className: string; label?: string }) {
  const left = percent(start, from, to);
  const right = percent(end, from, to);
  const width = Math.max(right - left, 0.6);
  return (
    <div className={cn('absolute h-[5px] rounded-sm', className)} style={{ left: `${left}%`, width: `${width}%`, top }}>
      {label && <span className="planner-print-bar-label">{label}</span>}
    </div>
  );
}

function fmtRange(startAt: string | null, endAt: string | null, withTime: boolean, notPlannedLabel: string): string {
  if (!startAt && !endAt) return notPlannedLabel;
  const fmt = (iso: string) => (withTime ? new Date(iso).toLocaleString() : new Date(iso).toLocaleDateString());
  return `${startAt ? fmt(startAt) : '?'} → ${endAt ? fmt(endAt) : '…'}`;
}

function PrintOrderRows({
  order,
  photoByAssembly,
  from,
  to,
  t,
  ts,
  tp,
  months,
}: {
  order: PlannerOrderNode;
  photoByAssembly: Record<string, string | undefined>;
  from: Date;
  to: Date;
  t: (k: string) => string;
  ts: (k: string) => string;
  tp: (k: string) => string;
  months: { start: Date }[];
}) {
  return (
    <>
      <tr className="planner-print-order">
        <td colSpan={2}>
          <strong>{order.orderNumber ? `№${order.orderNumber} — ` : ''}{order.clientName}</strong>{' '}
          <span className="text-[9px]">
            ({ts(`orderStatus${order.status}`)}
            {order.riskLevel !== 'none' && `, ${t(`risk${order.riskLevel === 'critical' ? 'Critical' : 'Warning'}`)}`})
          </span>
        </td>
        <td className="relative">
          <MonthGrid from={from} to={to} months={months} />
          {order.plan.startAt && order.plan.completionAt && (
            <MiniBar start={new Date(order.plan.startAt)} end={new Date(order.plan.completionAt)} from={from} to={to} top={3} className="bg-foreground/70" />
          )}
        </td>
      </tr>
      {order.items.map((item) => (
        <PrintItemRows key={item.id} order={order} item={item} photoByAssembly={photoByAssembly} from={from} to={to} t={t} tp={tp} months={months} />
      ))}
      {order.purchaseOrders.map((po) => (
        <tr key={po.id}>
          <td className="pl-4 text-[9px]">
            {t('materials')}: {po.supplierName}
            <br />
            <span className="planner-print-muted">{po.status} · {po.expectedDeliveryDate ? new Date(po.expectedDeliveryDate).toLocaleDateString() : t('notPlanned')}</span>
          </td>
          <td />
          <td className="relative">
            <MonthGrid from={from} to={to} months={months} />
            {po.expectedDeliveryDate && <MiniBar start={new Date(po.orderDate)} end={new Date(po.expectedDeliveryDate)} from={from} to={to} top={4} className="bg-muted-foreground/60" />}
          </td>
        </tr>
      ))}
    </>
  );
}

function PrintItemRows({
  order,
  item,
  photoByAssembly,
  from,
  to,
  t,
  tp,
  months,
}: {
  order: PlannerOrderNode;
  item: PlannerItemNode;
  photoByAssembly: Record<string, string | undefined>;
  from: Date;
  to: Date;
  t: (k: string) => string;
  tp: (k: string) => string;
  months: { start: Date }[];
}) {
  const photo = photoByAssembly[item.assemblyId];
  const s = item.quantitySummary;
  return (
    <>
      <tr className="planner-print-item">
        <td className="pl-2">
          <div className="flex items-center gap-2">
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element -- print-only static image, same short-lived-signed-URL reasoning as components/ui/avatar.tsx
              <img src={photo} alt="" className="planner-print-photo" />
            ) : (
              <span className="planner-print-photo planner-print-photo-empty">{t('noPhoto')}</span>
            )}
            <span>
              <strong>{item.assemblyName}</strong> × {item.qty}
              <br />
              <span className="text-[9px]">{item.article ? `${t('article')}: ${item.article}` : t('noArticle')}</span>
              <br />
              <span className="text-[8px] planner-print-muted">
                {t('ordered')} {s.ordered} · {t('inProduction')} {s.inProduction} · {t('completed')} {s.completed} · {t('remaining')} {s.remaining}
              </span>
            </span>
          </div>
        </td>
        <td />
        <td className="relative">
          <MonthGrid from={from} to={to} months={months} />
          {item.plan.startAt && item.plan.endAt && <MiniBar start={new Date(item.plan.startAt)} end={new Date(item.plan.endAt)} from={from} to={to} top={4} className="bg-foreground/70" />}
        </td>
      </tr>
      {item.batches.map((batch) => (
        <PrintBatchRows key={batch.id} order={order} item={item} batch={batch} from={from} to={to} t={t} tp={tp} months={months} />
      ))}
      {item.problems.length > 0 && (
        <tr>
          <td colSpan={3} className="pl-4 text-[9px] text-red-700">
            {item.problems.map((p, i) => (
              <div key={i}>⚠ {p.message}</div>
            ))}
          </td>
        </tr>
      )}
    </>
  );
}

function PrintBatchRows({
  batch,
  from,
  to,
  t,
  tp,
  months,
}: {
  order: PlannerOrderNode;
  item: PlannerItemNode;
  batch: PlannerBatchNode;
  from: Date;
  to: Date;
  t: (k: string) => string;
  tp: (k: string) => string;
  months: { start: Date }[];
}) {
  return (
    <>
      <tr>
        <td className="pl-4 text-[9px]">
          <strong>{t('batch')} · {batch.unitsPlanned} {t('units')}</strong>
          <br />
          <span className="planner-print-muted">{t('planLabel')}: {fmtRange(batch.plan.startAt, batch.plan.endAt, false, t('notPlanned'))}</span>
          <br />
          <span className="planner-print-muted">{t('factLabel')}: {batch.fact.startAt ? fmtRange(batch.fact.startAt, batch.fact.endAt, false, '—') : '—'}</span>
        </td>
        <td className="text-[9px]">{tp(`status${batch.status}`)}</td>
        <td className="relative">
          <MonthGrid from={from} to={to} months={months} />
          {batch.plan.startAt && batch.plan.endAt && <MiniBar start={new Date(batch.plan.startAt)} end={new Date(batch.plan.endAt)} from={from} to={to} top={3} className="bg-foreground/50" />}
          {batch.fact.startAt && batch.fact.endAt && <MiniBar start={new Date(batch.fact.startAt)} end={new Date(batch.fact.endAt)} from={from} to={to} top={10} className="bg-foreground/95" />}
        </td>
      </tr>
      {batch.stages.map((stage) => (
        <tr key={stage.id}>
          <td className="pl-6 text-[8px]">
            {stage.name}
            <br />
            <span className="planner-print-muted">{stage.plan ? fmtRange(stage.plan.startAt, stage.plan.endAt, true, t('notPlanned')) : t('notPlanned')}</span>
          </td>
          <td />
          <td className="relative">
            <MonthGrid from={from} to={to} months={months} />
            {stage.plan?.startAt && stage.plan?.endAt && <MiniBar start={new Date(stage.plan.startAt)} end={new Date(stage.plan.endAt)} from={from} to={to} top={4} className="bg-primary/80" />}
          </td>
        </tr>
      ))}
    </>
  );
}
