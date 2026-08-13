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
 * page" on paper. Each row still carries a real small percent-positioned
 * plan/fact bar (scoped to that row's own cell, so it paginates with its
 * row like any other table content) — this is the standard, robust way
 * production/scheduling software renders a Gantt to paper; a canvas that
 * must itself survive being cut across page boundaries is not.
 * Always fully expanded (a printed dispatcher document has no "collapsed"
 * state) — the interactive view's expand/collapse is purely a screen
 * convenience and isn't reflected here.
 */
export function PlannerGanttPrintTable({ orders, photoByAssembly, from, to }: { orders: PlannerOrderNode[]; photoByAssembly: Record<string, string | undefined>; from: Date; to: Date }) {
  const t = useTranslations('planner');
  const ts = useTranslations('sales');
  const tp = useTranslations('production');
  const months = monthMarks(from, to);

  return (
    <table className="planner-print-table">
      <thead>
        <tr>
          <th style={{ width: '38%' }}>{t('printColHierarchy')}</th>
          <th style={{ width: '14%' }}>{t('printColStatus')}</th>
          <th style={{ width: '18%' }}>{t('printColPlan')}</th>
          <th style={{ width: '18%' }}>{t('printColFact')}</th>
          <th>
            <div className="relative h-4 w-full">
              {months.map((m, i) => (
                <span key={i} className="absolute top-0 text-[8px]" style={{ left: `${percent(m.start, from, to)}%` }}>
                  {m.label}
                </span>
              ))}
            </div>
          </th>
        </tr>
      </thead>
      <tbody>
        {orders.map((order) => (
          <PrintOrderRows key={order.id} order={order} photoByAssembly={photoByAssembly} from={from} to={to} t={t} ts={ts} tp={tp} />
        ))}
      </tbody>
    </table>
  );
}

function MiniBar({ start, end, from, to, className }: { start: Date; end: Date; from: Date; to: Date; className: string }) {
  const left = percent(start, from, to);
  const right = percent(end, from, to);
  const width = Math.max(right - left, 0.8);
  return <div className={cn('absolute top-0 h-2 rounded-sm', className)} style={{ left: `${left}%`, width: `${width}%` }} />;
}

function PrintOrderRows({
  order,
  photoByAssembly,
  from,
  to,
  t,
  ts,
  tp,
}: {
  order: PlannerOrderNode;
  photoByAssembly: Record<string, string | undefined>;
  from: Date;
  to: Date;
  t: (k: string) => string;
  ts: (k: string) => string;
  tp: (k: string) => string;
}) {
  return (
    <>
      <tr className="planner-print-order">
        <td colSpan={4}>
          <strong>{order.orderNumber ? `№${order.orderNumber} — ` : ''}{order.clientName}</strong>{' '}
          <span className="text-[9px]">
            ({ts(`orderStatus${order.status}`)}
            {order.riskLevel !== 'none' && `, ${t(`risk${order.riskLevel === 'critical' ? 'Critical' : 'Warning'}`)}`})
          </span>
        </td>
        <td className="relative">
          {order.plan.startAt && order.plan.completionAt && (
            <MiniBar start={new Date(order.plan.startAt)} end={new Date(order.plan.completionAt)} from={from} to={to} className="bg-foreground/60" />
          )}
        </td>
      </tr>
      {order.items.map((item) => (
        <PrintItemRows key={item.id} order={order} item={item} photoByAssembly={photoByAssembly} from={from} to={to} t={t} tp={tp} />
      ))}
      {order.purchaseOrders.map((po) => (
        <tr key={po.id}>
          <td className="pl-4">{t('materials')}: {po.supplierName}</td>
          <td>{po.status}</td>
          <td colSpan={2}>{po.expectedDeliveryDate ? new Date(po.expectedDeliveryDate).toLocaleDateString() : t('notPlanned')}</td>
          <td className="relative">
            {po.expectedDeliveryDate && <MiniBar start={new Date(po.orderDate)} end={new Date(po.expectedDeliveryDate)} from={from} to={to} className="bg-muted-foreground/50" />}
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
}: {
  order: PlannerOrderNode;
  item: PlannerItemNode;
  photoByAssembly: Record<string, string | undefined>;
  from: Date;
  to: Date;
  t: (k: string) => string;
  tp: (k: string) => string;
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
            </span>
          </div>
        </td>
        <td colSpan={3} className="text-[9px]">
          {t('ordered')}: {s.ordered} · {t('inProduction')}: {s.inProduction} · {t('completed')}: {s.completed} · {t('remaining')}: {s.remaining}
        </td>
        <td className="relative">
          {item.plan.startAt && item.plan.endAt && <MiniBar start={new Date(item.plan.startAt)} end={new Date(item.plan.endAt)} from={from} to={to} className="bg-foreground/60" />}
        </td>
      </tr>
      {item.batches.map((batch) => (
        <PrintBatchRows key={batch.id} order={order} item={item} batch={batch} from={from} to={to} t={t} tp={tp} />
      ))}
      {item.problems.length > 0 && (
        <tr>
          <td colSpan={5} className="pl-4 text-[9px] text-red-700">
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
}: {
  order: PlannerOrderNode;
  item: PlannerItemNode;
  batch: PlannerBatchNode;
  from: Date;
  to: Date;
  t: (k: string) => string;
  tp: (k: string) => string;
}) {
  return (
    <>
      <tr>
        <td className="pl-4">
          {t('batch')} · {batch.unitsPlanned} {t('units')}
        </td>
        <td className="text-[9px]">{tp(`status${batch.status}`)}</td>
        <td className="text-[9px]">{batch.plan.startAt ? `${new Date(batch.plan.startAt).toLocaleDateString()} → ${batch.plan.endAt ? new Date(batch.plan.endAt).toLocaleDateString() : ''}` : t('notPlanned')}</td>
        <td className="text-[9px]">{batch.fact.startAt ? `${new Date(batch.fact.startAt).toLocaleDateString()} → ${batch.fact.endAt ? new Date(batch.fact.endAt).toLocaleDateString() : '…'}` : '—'}</td>
        <td className="relative">
          {batch.plan.startAt && batch.plan.endAt && <MiniBar start={new Date(batch.plan.startAt)} end={new Date(batch.plan.endAt)} from={from} to={to} className="bg-foreground/40" />}
          {batch.fact.startAt && batch.fact.endAt && <MiniBar start={new Date(batch.fact.startAt)} end={new Date(batch.fact.endAt)} from={from} to={to} className="bg-foreground/90" />}
        </td>
      </tr>
      {batch.stages.map((stage) => (
        <tr key={stage.id}>
          <td className="pl-6 text-[9px]">{stage.name}</td>
          <td colSpan={3} className="text-[9px]">
            {stage.plan ? `${stage.plan.startAt ? new Date(stage.plan.startAt).toLocaleString() : ''} → ${stage.plan.endAt ? new Date(stage.plan.endAt).toLocaleString() : ''}` : t('notPlanned')}
          </td>
          <td className="relative">
            {stage.plan?.startAt && stage.plan?.endAt && <MiniBar start={new Date(stage.plan.startAt)} end={new Date(stage.plan.endAt)} from={from} to={to} className="bg-primary/70" />}
          </td>
        </tr>
      ))}
    </>
  );
}
