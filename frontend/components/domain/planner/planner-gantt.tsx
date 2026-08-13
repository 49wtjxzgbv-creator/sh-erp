'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { timelinePercent as percent, timelineMonthMarks as monthMarks, timelineWeekMarks as weekMarks } from '@/lib/timeline-utils';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { PlannerBatchNode, PlannerItemNode, PlannerOrderNode } from '@/lib/api-client/planner';

/**
 * The actual hierarchical Gantt (Ієрархічна діаграма Ганта) — a real
 * percent-positioned timeline, same technique as the Dashboard's
 * operations-timeline.tsx (lib/timeline-utils.ts's month/week gridlines +
 * "today" marker), applied one level deeper: CustomerOrder → CustomerOrderItem
 * → ProductionOrder batch → stage. Plan and fact are two visually distinct
 * bars on a batch row, never blended into one — a stage with no plan draws
 * no bar at all (just the "не заплановано" label), never a guessed
 * position. Collapsed by default below the order level so a real company's
 * full order list stays readable; expanding an order/item reveals its
 * children's own bars on the same shared axis.
 */

const ROW_HEIGHT = 30;
const LABEL_WIDTH = 260;

interface Window {
  start: Date;
  end: Date;
}

function toWindow(startAt: string | null, endAt: string | null): Window | null {
  if (!startAt && !endAt) return null;
  const start = new Date(startAt ?? endAt!);
  const end = new Date(endAt ?? startAt!);
  return end < start ? { start: end, end: start } : { start, end };
}

function unionWindows(windows: (Window | null)[]): Window | null {
  const real = windows.filter((w): w is Window => w != null);
  if (real.length === 0) return null;
  return {
    start: new Date(Math.min(...real.map((w) => w.start.getTime()))),
    end: new Date(Math.max(...real.map((w) => w.end.getTime()))),
  };
}

function batchPlanWindow(b: PlannerBatchNode): Window | null {
  return toWindow(b.plan.startAt, b.plan.endAt);
}
function batchFactWindow(b: PlannerBatchNode, now: Date): Window | null {
  const w = toWindow(b.fact.startAt, b.fact.endAt);
  if (!w) return null;
  return b.fact.endAt ? w : { start: w.start, end: now };
}
function itemWindow(i: PlannerItemNode): Window | null {
  return toWindow(i.plan.startAt, i.plan.endAt) ?? unionWindows(i.batches.map(batchPlanWindow));
}
function orderWindow(o: PlannerOrderNode): Window | null {
  return toWindow(o.plan.startAt, o.plan.completionAt) ?? unionWindows(o.items.map(itemWindow));
}

type RiskColor = 'none' | 'warning' | 'critical';

const BAR_COLOR: Record<RiskColor, string> = {
  none: 'border-l-secondary-foreground/40 bg-secondary text-secondary-foreground',
  warning: 'border-l-warning bg-warning/20 text-warning-foreground',
  critical: 'border-l-destructive bg-destructive/20 text-destructive-foreground',
};

function Bar({ window, from, to, color, title }: { window: Window; from: Date; to: Date; color: string; title: string }) {
  const left = percent(window.start, from, to);
  const right = percent(window.end, from, to);
  const width = Math.max(right - left, 0.6);
  return (
    <div
      title={title}
      className={cn('absolute top-1 h-4 truncate rounded-r border-l-4 px-1 text-[10px] leading-4 shadow-sm', color)}
      style={{ left: `${left}%`, width: `${width}%` }}
    />
  );
}

function StageBar({ window, from, to }: { window: Window; from: Date; to: Date }) {
  const left = percent(window.start, from, to);
  const right = percent(window.end, from, to);
  const width = Math.max(right - left, 0.4);
  return <div className="absolute top-2 h-2 rounded-sm bg-primary/70" style={{ left: `${left}%`, width: `${width}%` }} />;
}

function GanttRow({
  indent,
  label,
  href,
  expanded,
  hasChildren,
  onToggle,
  children,
  rowIndex,
}: {
  indent: number;
  label: React.ReactNode;
  href?: string;
  expanded?: boolean;
  hasChildren?: boolean;
  onToggle?: () => void;
  children?: React.ReactNode;
  rowIndex: number;
}) {
  return (
    <div className={cn('relative flex border-b border-border/60', rowIndex % 2 === 1 && 'bg-muted/20')} style={{ height: ROW_HEIGHT }}>
      <div className="flex shrink-0 items-center gap-1 overflow-hidden pr-2 text-xs" style={{ width: LABEL_WIDTH, paddingLeft: 8 + indent * 14 }}>
        {hasChildren ? (
          <button type="button" onClick={onToggle} className="shrink-0 rounded hover:bg-secondary">
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {href ? (
          <Link href={href} className="truncate text-primary hover:underline">
            {label}
          </Link>
        ) : (
          <span className="truncate">{label}</span>
        )}
      </div>
      <div className="relative min-w-[900px] flex-1">{children}</div>
    </div>
  );
}

export function PlannerGanttChart({ orders, from, to }: { orders: PlannerOrderNode[]; from: Date; to: Date }) {
  const t = useTranslations('planner');
  const ts = useTranslations('sales');
  const tp = useTranslations('production');
  const now = useMemo(() => new Date(), []);

  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());

  const months = useMemo(() => monthMarks(from, to), [from, to]);
  const weeks = useMemo(() => weekMarks(from, to), [from, to]);
  const showToday = now >= from && now <= to;

  function toggle(set: Set<string>, setSet: (s: Set<string>) => void, id: string) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSet(next);
  }

  let rowIndex = -1;
  const rows: React.ReactNode[] = [];

  for (const order of orders) {
    rowIndex += 1;
    const oWindow = orderWindow(order);
    const orderExpanded = expandedOrders.has(order.id);
    const color: RiskColor = order.riskLevel;
    rows.push(
      <GanttRow
        key={order.id}
        indent={0}
        rowIndex={rowIndex}
        label={
          <span className="flex items-center gap-1 font-medium">
            {order.orderNumber ? `№${order.orderNumber}` : order.clientName}
            {order.riskLevel !== 'none' && <AlertTriangle className={cn('h-3 w-3 shrink-0', order.riskLevel === 'critical' ? 'text-destructive' : 'text-warning')} />}
          </span>
        }
        href={`/sales/${order.id}`}
        hasChildren={order.items.length > 0}
        expanded={orderExpanded}
        onToggle={() => toggle(expandedOrders, setExpandedOrders, order.id)}
      >
        {oWindow && <Bar window={oWindow} from={from} to={to} color={BAR_COLOR[color]} title={`${order.clientName}: ${oWindow.start.toLocaleDateString()} → ${oWindow.end.toLocaleDateString()}`} />}
      </GanttRow>,
    );

    if (!orderExpanded) continue;

    for (const item of order.items) {
      rowIndex += 1;
      const iWindow = itemWindow(item);
      const itemExpanded = expandedItems.has(item.id);
      const itemColor: RiskColor = item.problems.some((p) => p.severity === 'critical') ? 'critical' : item.problems.some((p) => p.severity === 'warning') ? 'warning' : 'none';
      rows.push(
        <GanttRow
          key={item.id}
          indent={1}
          rowIndex={rowIndex}
          label={
            <span className="flex items-center gap-1">
              {item.assemblyName} × {item.qty}
              <span className="ml-1 shrink-0 text-[10px] text-muted-foreground">
                {t('remaining')}: {item.quantitySummary.remaining}
              </span>
            </span>
          }
          hasChildren={item.batches.length > 0}
          expanded={itemExpanded}
          onToggle={() => toggle(expandedItems, setExpandedItems, item.id)}
        >
          {iWindow && <Bar window={iWindow} from={from} to={to} color={BAR_COLOR[itemColor]} title={`${item.assemblyName}: ${iWindow.start.toLocaleDateString()} → ${iWindow.end.toLocaleDateString()}`} />}
        </GanttRow>,
      );

      if (!itemExpanded) continue;

      for (const batch of item.batches) {
        rowIndex += 1;
        const planW = batchPlanWindow(batch);
        const factW = batchFactWindow(batch, now);
        const batchExpanded = expandedBatches.has(batch.id);
        const batchColor: RiskColor = batch.problems.some((p) => p.severity === 'critical') ? 'critical' : batch.problems.some((p) => p.severity === 'warning') ? 'warning' : 'none';
        rows.push(
          <GanttRow
            key={batch.id}
            indent={2}
            rowIndex={rowIndex}
            label={
              <span className="flex items-center gap-1.5">
                {t('batch')} · {batch.unitsPlanned}
                <Badge variant="outline" className="px-1 py-0 text-[10px]">
                  {tp(`status${batch.status}`)}
                </Badge>
              </span>
            }
            href={`/production/${batch.id}`}
            hasChildren={batch.stages.length > 0}
            expanded={batchExpanded}
            onToggle={() => toggle(expandedBatches, setExpandedBatches, batch.id)}
          >
            {planW && <Bar window={planW} from={from} to={to} color={cn('opacity-60', BAR_COLOR[batchColor])} title={`${t('planLabel')}: ${planW.start.toLocaleString()} → ${planW.end.toLocaleString()}`} />}
            {factW && (
              <div
                title={`${t('factLabel')}: ${factW.start.toLocaleString()} → ${batch.fact.endAt ? factW.end.toLocaleString() : '…'}`}
                className="absolute top-[18px] h-2 rounded-sm bg-foreground/70"
                style={{ left: `${percent(factW.start, from, to)}%`, width: `${Math.max(percent(factW.end, from, to) - percent(factW.start, from, to), 0.4)}%` }}
              />
            )}
          </GanttRow>,
        );

        if (!batchExpanded) continue;

        for (const stage of batch.stages) {
          rowIndex += 1;
          const sWindow = stage.plan ? toWindow(stage.plan.startAt, stage.plan.endAt) : null;
          rows.push(
            <GanttRow key={stage.id} indent={3} rowIndex={rowIndex} label={<span className={cn(!sWindow && 'italic text-muted-foreground')}>{stage.name}{!sWindow && ` (${t('notPlanned')})`}</span>}>
              {sWindow && <StageBar window={sWindow} from={from} to={to} />}
            </GanttRow>,
          );
        }
      }
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="overflow-x-auto">
        <div className="relative flex pb-1" style={{ paddingLeft: LABEL_WIDTH }}>
          <div className="relative h-5 min-w-[900px] flex-1">
            {months.map((m, i) => (
              <span key={i} className="absolute top-0 text-xs text-muted-foreground" style={{ left: `${percent(m.start, from, to)}%` }}>
                {m.label}
              </span>
            ))}
          </div>
        </div>
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0" style={{ left: LABEL_WIDTH, right: 0 }}>
            {weeks.map((w, i) => (
              <div key={i} className="absolute inset-y-0 w-px bg-border/40" style={{ left: `${percent(w, from, to)}%` }} />
            ))}
            {months.map((m, i) => (
              <div key={i} className="absolute inset-y-0 w-px bg-border" style={{ left: `${percent(m.start, from, to)}%` }} />
            ))}
            {showToday && <div className="absolute inset-y-0 z-10 w-px bg-primary" style={{ left: `${percent(now, from, to)}%` }} />}
          </div>
          {rows}
        </div>
      </div>
    </div>
  );
}
