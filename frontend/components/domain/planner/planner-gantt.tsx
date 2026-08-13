'use client';

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  AlertCircle,
  Clock,
  Cog,
  CheckCircle2,
  Lock,
  Minus,
  Plus,
  Truck,
} from 'lucide-react';
import { timelineDayMarks, timelineHourMarks, timelineMonthMarks, timelineWeekMarks, isWeekend } from '@/lib/timeline-utils';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import type { PlannerBatchNode, PlannerItemNode, PlannerOrderNode, PlannerProblem } from '@/lib/api-client/planner';

/**
 * The actual hierarchical production Gantt (professional dispatcher view,
 * not a dashboard card list). Order -> Item -> Batch -> Stage, each
 * expandable, rendered on a real pixel-positioned timeline (day/week/month/
 * quarter scale + independent zoom, both driving pxPerDay — not just a
 * relabeled header). Sticky left column (photo/name/article/quantity —
 * only at Item level, per the "no visual noise on every batch/stage" rule)
 * and sticky timeline header, inside one scrollable viewport, matching the
 * spreadsheet-like Gantt convention. Plan (outline bar) and fact (solid
 * inner bar) are always visually distinct; a stage with no plan draws no
 * bar at all — "Етап не запланований" instead, never a guessed position.
 *
 * No Gantt library — same hand-built percent/px positioning approach as
 * lib/timeline-utils.ts's other consumers (dashboard's operations-
 * timeline.tsx, production's schedule-timeline.tsx), just with real pixel
 * widths instead of percentages so zoom has something real to change.
 */

export type GanttScale = 'day' | 'week' | 'month' | 'quarter' | 'year';

const BASE_PX_PER_DAY: Record<Exclude<GanttScale, 'year'>, number> = { day: 480, week: 34, month: 11, quarter: 3.4 };
const WINDOW_DAYS: Record<Exclude<GanttScale, 'year'>, number> = { day: 10, week: 90, month: 420, quarter: 900 };
const PAN_STEP_DAYS: Record<Exclude<GanttScale, 'year'>, number> = { day: 3, week: 21, month: 90, quarter: 180 };
/** §23: two distinct zoom levels for the Year scale — an overview (12 month bars, strategic load-at-a-glance) and a detail level (month + week gridlines) — not just a shrunk Month view. */
const YEAR_PX_PER_DAY = { overview: 2.4, detail: 9 };

function daysInYear(year: number): number {
  return (new Date(year, 11, 31).getTime() - new Date(year, 0, 1).getTime()) / 86400000 + 1;
}

const ROW_HEIGHT = 34;
const LABEL_WIDTH = 300;

export interface Window {
  start: Date;
  end: Date;
}

export function toWindow(startAt: string | null, endAt: string | null): Window | null {
  if (!startAt && !endAt) return null;
  const start = new Date(startAt ?? endAt!);
  const end = new Date(endAt ?? startAt!);
  return end < start ? { start: end, end: start } : { start, end };
}

export function unionWindows(windows: (Window | null)[]): Window | null {
  const real = windows.filter((w): w is Window => w != null);
  if (real.length === 0) return null;
  return {
    start: new Date(Math.min(...real.map((w) => w.start.getTime()))),
    end: new Date(Math.max(...real.map((w) => w.end.getTime()))),
  };
}

export function batchPlanWindow(b: PlannerBatchNode): Window | null {
  return toWindow(b.plan.startAt, b.plan.endAt);
}
export function batchFactWindow(b: PlannerBatchNode, now: Date): Window | null {
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
function riskOf(problems: PlannerProblem[]): RiskColor {
  if (problems.some((p) => p.severity === 'critical')) return 'critical';
  if (problems.some((p) => p.severity === 'warning')) return 'warning';
  return 'none';
}

// Bold, solid blocks — a professional dispatcher Gantt reads at a glance
// from filled bars, not thin translucent slivers. Deliberately higher
// opacity/heavier border than this app's other hand-built timelines
// (operations-timeline.tsx's dashboard widget), since this chart is the
// primary daily tool, not a summary card.
const BAR_COLOR: Record<RiskColor, string> = {
  none: 'border-l-4 border-secondary-foreground/70 bg-secondary shadow-sm',
  warning: 'border-l-4 border-warning bg-warning/60 shadow-sm',
  critical: 'border-l-4 border-destructive bg-destructive/60 shadow-sm',
};

type BatchStatusKey = PlannerBatchNode['status'] | 'OVERDUE';
const STATUS_ICON: Record<BatchStatusKey, typeof Clock> = {
  PLANNED: Clock,
  IN_PROGRESS: Cog,
  COMPLETED: CheckCircle2,
  CANCELLED: Lock,
  OVERDUE: AlertTriangle,
};
const STATUS_COLOR: Record<BatchStatusKey, string> = {
  PLANNED: 'text-muted-foreground',
  IN_PROGRESS: 'text-warning',
  COMPLETED: 'text-success',
  CANCELLED: 'text-muted-foreground',
  OVERDUE: 'text-destructive',
};

/** A colored left rail per hierarchy depth on the label cell — the tree structure (Замовлення → Виріб → Партія → Етап) should read from a glance down the left edge, not just from indentation alone. */
const LEVEL_ACCENT = ['', 'border-l-4 border-l-primary/70', 'border-l-4 border-l-secondary-foreground/50', 'border-l-4 border-l-muted-foreground/35'];

function batchStatusKey(b: PlannerBatchNode, now: Date): BatchStatusKey {
  if (b.status === 'PLANNED' && b.plan.endAt && new Date(b.plan.endAt) < now) return 'OVERDUE';
  return b.status;
}

export function px(day: Date, viewFrom: Date, pxPerDay: number): number {
  return ((day.getTime() - viewFrom.getTime()) / 86400000) * pxPerDay;
}

/** Row identity used for search/scroll-to-problem/expand-ancestors — cheap string key, not a real entity type. */
type NodeKind = 'order' | 'item' | 'batch' | 'stage' | 'po';

interface FlatRow {
  key: string;
  kind: NodeKind;
  level: number;
  order: PlannerOrderNode;
  item?: PlannerItemNode;
  batch?: PlannerBatchNode;
  searchText: string;
}

export interface PlannerGanttHandle {
  /** Expands every ancestor of the given entity and scrolls/flashes its row — used by the problems panel's "jump to row" click. */
  revealEntity: (entityType: PlannerProblem['entityType'], entityId: string, orderId: string) => void;
}

function StatusBadge({ statusKey, label }: { statusKey: BatchStatusKey; label: string }) {
  const Icon = STATUS_ICON[statusKey];
  return (
    <span className={cn('flex items-center gap-1 text-[10px] font-medium', STATUS_COLOR[statusKey])}>
      <Icon className="h-3 w-3 shrink-0" />
      {label}
    </span>
  );
}

/**
 * Drawn across the full row width whenever a node has no plan date at all
 * — never a specific position (that would be inventing a date), just a
 * dashed placeholder so an unplanned row still visibly belongs to the
 * timeline grid instead of reading as blank/broken space.
 */
function UnplannedTrack({ top, height, faint }: { top: number; height: number; faint?: boolean }) {
  return <div className={cn('absolute left-2 right-2 rounded border-2 border-dashed', faint ? 'border-muted-foreground/25' : 'border-muted-foreground/40')} style={{ top, height }} />;
}

export const PlannerGanttChart = forwardRef<
  PlannerGanttHandle,
  { orders: PlannerOrderNode[]; photoByAssembly: Record<string, string | undefined>; year: number; onYearChange: (y: number) => void }
>(function PlannerGanttChart({ orders, photoByAssembly, year, onYearChange }, ref) {
    const t = useTranslations('planner');
    const tp = useTranslations('production');
    const now = useMemo(() => new Date(), []);

    const [scale, setScale] = useState<GanttScale>('month');
    const [zoom, setZoom] = useState(1);
    const [anchor, setAnchor] = useState(now);
    const [yearDetail, setYearDetail] = useState(false);
    const [search, setSearch] = useState('');
    const [flashKey, setFlashKey] = useState<string | null>(null);

    const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
    const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
    const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());

    const scrollRef = useRef<HTMLDivElement>(null);
    const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

    const isYearScale = scale === 'year';
    const pxPerDay = (isYearScale ? YEAR_PX_PER_DAY[yearDetail ? 'detail' : 'overview'] : BASE_PX_PER_DAY[scale]) * zoom;
    const windowDays = isYearScale ? daysInYear(year) : WINDOW_DAYS[scale];
    const viewFrom = useMemo(() => (isYearScale ? new Date(year, 0, 1) : new Date(anchor.getTime() - (windowDays / 2) * 86400000)), [isYearScale, year, anchor, windowDays]);
    const viewTo = useMemo(() => (isYearScale ? new Date(year, 11, 31, 23, 59, 59) : new Date(anchor.getTime() + (windowDays / 2) * 86400000)), [isYearScale, year, anchor, windowDays]);
    const canvasWidth = Math.max(windowDays * pxPerDay, 600);

    function toggle(set: Set<string>, setSet: (s: Set<string>) => void, id: string) {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSet(next);
    }

    function scrollToDate(date: Date) {
      const container = scrollRef.current;
      if (!container) return;
      const offset = px(date, viewFrom, pxPerDay);
      container.scrollTo({ left: Math.max(offset - container.clientWidth / 2, 0), behavior: 'smooth' });
    }

    useEffect(() => {
      const target = isYearScale ? (year === now.getFullYear() ? now : new Date(year, 0, 1)) : now;
      scrollToDate(target);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scale, year, yearDetail]);

    useImperativeHandle(ref, () => ({
      revealEntity(entityType, entityId, orderId) {
        const nextOrders = new Set(expandedOrders);
        nextOrders.add(orderId);
        setExpandedOrders(nextOrders);
        let targetKey = `order:${orderId}`;
        let targetWindow: Window | null = null;
        const order = orders.find((o) => o.id === orderId);
        if (order) {
          if (entityType === 'CustomerOrderItem') {
            targetKey = `item:${entityId}`;
          } else if (entityType === 'ProductionOrder') {
            const item = order.items.find((i) => i.batches.some((b) => b.id === entityId));
            if (item) {
              const nextItems = new Set(expandedItems);
              nextItems.add(item.id);
              setExpandedItems(nextItems);
            }
            targetKey = `batch:${entityId}`;
            const batch = order.items.flatMap((i) => i.batches).find((b) => b.id === entityId);
            if (batch) targetWindow = batchPlanWindow(batch) ?? batchFactWindow(batch, now);
          } else if (entityType === 'PurchaseOrder') {
            targetKey = `po:${entityId}`;
          }
        }
        setFlashKey(targetKey);
        window.setTimeout(() => setFlashKey(null), 2000);
        window.setTimeout(() => {
          rowRefs.current.get(targetKey)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          if (targetWindow) scrollToDate(targetWindow.start);
        }, 50);
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }));

    // ---- Search: finds first match across order#/client/item name/article/supplier, expands ancestors, scrolls ----
    function runSearch(query: string) {
      setSearch(query);
      const q = query.trim().toLowerCase();
      if (!q) return;
      for (const order of orders) {
        const orderMatch = order.clientName.toLowerCase().includes(q) || (order.orderNumber ?? '').toLowerCase().includes(q) || order.purchaseOrders.some((po) => po.supplierName.toLowerCase().includes(q));
        if (orderMatch) {
          const next = new Set(expandedOrders);
          next.add(order.id);
          setExpandedOrders(next);
          setFlashKey(`order:${order.id}`);
          window.setTimeout(() => rowRefs.current.get(`order:${order.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
          window.setTimeout(() => setFlashKey(null), 2000);
          return;
        }
        for (const item of order.items) {
          const itemMatch = item.assemblyName.toLowerCase().includes(q) || (item.article ?? '').toLowerCase().includes(q);
          if (itemMatch) {
            const nOrders = new Set(expandedOrders);
            nOrders.add(order.id);
            setExpandedOrders(nOrders);
            setFlashKey(`item:${item.id}`);
            window.setTimeout(() => rowRefs.current.get(`item:${item.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
            window.setTimeout(() => setFlashKey(null), 2000);
            return;
          }
        }
      }
    }

    // ---- Flatten visible rows respecting expand state ----
    const rows: FlatRow[] = [];
    for (const order of orders) {
      rows.push({ key: `order:${order.id}`, kind: 'order', level: 0, order, searchText: order.clientName });
      if (!expandedOrders.has(order.id)) continue;

      for (const po of order.purchaseOrders) {
        rows.push({ key: `po:${po.id}`, kind: 'po', level: 1, order, searchText: po.supplierName });
      }

      for (const item of order.items) {
        rows.push({ key: `item:${item.id}`, kind: 'item', level: 1, order, item, searchText: `${item.assemblyName} ${item.article ?? ''}` });
        if (!expandedItems.has(item.id)) continue;

        for (const batch of item.batches) {
          rows.push({ key: `batch:${batch.id}`, kind: 'batch', level: 2, order, item, batch, searchText: '' });
          if (!expandedBatches.has(batch.id)) continue;
          for (const stage of batch.stages) {
            rows.push({ key: `stage:${stage.id}:${batch.id}`, kind: 'stage', level: 3, order, item, batch, searchText: stage.name });
          }
        }
      }
    }

    // ---- Time axis ticks for the current scale ----
    const months = useMemo(() => timelineMonthMarks(viewFrom, viewTo), [viewFrom, viewTo]);
    const days = useMemo(() => ((scale === 'day' || scale === 'week') ? timelineDayMarks(viewFrom, viewTo) : []), [scale, viewFrom, viewTo]);
    const hours = useMemo(() => (scale === 'day' ? timelineHourMarks(viewFrom, viewTo) : []), [scale, viewFrom, viewTo]);
    const yearWeeks = useMemo(() => (isYearScale && yearDetail ? timelineWeekMarks(viewFrom, viewTo) : []), [isYearScale, yearDetail, viewFrom, viewTo]);
    const showToday = now >= viewFrom && now <= viewTo;

    return (
      <div className="flex flex-col gap-2">
        <GanttToolbar
          scale={scale}
          setScale={setScale}
          zoom={zoom}
          setZoom={setZoom}
          search={search}
          onSearch={runSearch}
          year={year}
          onYearChange={onYearChange}
          yearDetail={yearDetail}
          setYearDetail={setYearDetail}
          onToday={() => {
            setAnchor(new Date());
            if (isYearScale) onYearChange(now.getFullYear());
            scrollToDate(new Date());
          }}
          onPan={(dir) => {
            if (isYearScale) onYearChange(year + dir);
            else setAnchor(new Date(anchor.getTime() + dir * PAN_STEP_DAYS[scale] * 86400000));
          }}
        />

        <div ref={scrollRef} className="relative max-h-[70vh] overflow-auto rounded-lg border border-border">
          <div className="relative" style={{ width: LABEL_WIDTH + canvasWidth }}>
            {/* Sticky timeline header */}
            <div className="sticky top-0 z-20 flex border-b border-border bg-card">
              <div className="sticky left-0 z-30 flex shrink-0 items-end border-r border-border bg-card px-2 pb-1 text-xs font-semibold text-muted-foreground" style={{ width: LABEL_WIDTH }}>
                {t('title')}
              </div>
              <div className="relative shrink-0" style={{ width: canvasWidth, height: scale === 'day' ? 40 : 24 }}>
                {months.map((m, i) => (
                  <span key={i} className="absolute top-0 whitespace-nowrap text-xs font-medium" style={{ left: px(m.start, viewFrom, pxPerDay) + 4 }}>
                    {m.label}
                  </span>
                ))}
                {scale === 'day' &&
                  (() => {
                    // Hour labels need real horizontal room ("22:00" is ~5 characters) —
                    // at low zoom the raw 24-per-day set would overlap into an
                    // unreadable smear, so only every Nth hour gets a label (the tick
                    // line itself still shows every hour, just unlabeled between).
                    const pxPerHour = pxPerDay / 24;
                    const hourStep = Math.max(1, Math.ceil(34 / pxPerHour));
                    return hours
                      .filter((h) => h.getHours() % hourStep === 0)
                      .map((h, i) => (
                        <span key={i} className="absolute top-5 whitespace-nowrap text-[9px] text-muted-foreground" style={{ left: px(h, viewFrom, pxPerDay) + 2 }}>
                          {h.getHours()}:00
                        </span>
                      ));
                  })()}
              </div>
            </div>

            {/* Weekend shading + gridlines + today line, spanning full body height */}
            <div className="pointer-events-none absolute inset-y-0" style={{ left: LABEL_WIDTH, width: canvasWidth, top: scale === 'day' ? 40 : 24 }}>
              {(scale === 'day' || scale === 'week') &&
                days.map((d, i) =>
                  isWeekend(d) ? (
                    <div key={i} className="absolute inset-y-0 bg-muted/50" style={{ left: px(d, viewFrom, pxPerDay), width: pxPerDay }} />
                  ) : null,
                )}
              {days.map((d, i) => (
                <div key={`dl-${i}`} className="absolute inset-y-0 w-px bg-border/70" style={{ left: px(d, viewFrom, pxPerDay) }} />
              ))}
              {yearWeeks.map((w, i) => (
                <div key={`yw-${i}`} className="absolute inset-y-0 w-px bg-border/70" style={{ left: px(w, viewFrom, pxPerDay) }} />
              ))}
              {months.map((m, i) => (
                <div key={`ml-${i}`} className="absolute inset-y-0 w-px bg-border" style={{ left: px(m.start, viewFrom, pxPerDay) }} />
              ))}
              {showToday && <div className="absolute inset-y-0 z-10 w-0.5 bg-primary" style={{ left: px(now, viewFrom, pxPerDay) }} />}
            </div>

            {/* Rows */}
            <div className="relative">
              {rows.map((row, i) => (
                <GanttRowView
                  key={row.key}
                  row={row}
                  rowIndex={i}
                  viewFrom={viewFrom}
                  pxPerDay={pxPerDay}
                  now={now}
                  photoByAssembly={photoByAssembly}
                  flashed={flashKey === row.key}
                  expanded={row.kind === 'order' ? expandedOrders.has(row.order.id) : row.kind === 'item' ? expandedItems.has(row.item!.id) : row.kind === 'batch' ? expandedBatches.has(row.batch!.id) : false}
                  onToggle={() => {
                    if (row.kind === 'order') toggle(expandedOrders, setExpandedOrders, row.order.id);
                    else if (row.kind === 'item') toggle(expandedItems, setExpandedItems, row.item!.id);
                    else if (row.kind === 'batch') toggle(expandedBatches, setExpandedBatches, row.batch!.id);
                  }}
                  registerRef={(el) => {
                    if (el) rowRefs.current.set(row.key, el);
                    else rowRefs.current.delete(row.key);
                  }}
                  t={t}
                  tp={tp}
                />
              ))}
              {rows.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">{t('noOrders')}</p>}
            </div>
          </div>
        </div>
      </div>
    );
  },
);

function GanttToolbar({
  scale,
  setScale,
  zoom,
  setZoom,
  search,
  onSearch,
  year,
  onYearChange,
  yearDetail,
  setYearDetail,
  onToday,
  onPan,
}: {
  scale: GanttScale;
  setScale: (s: GanttScale) => void;
  zoom: number;
  setZoom: (z: number) => void;
  search: string;
  onSearch: (q: string) => void;
  year: number;
  onYearChange: (y: number) => void;
  yearDetail: boolean;
  setYearDetail: (v: boolean) => void;
  onToday: () => void;
  onPan: (dir: 1 | -1) => void;
}) {
  const t = useTranslations('planner');
  const SCALES: GanttScale[] = ['day', 'week', 'month', 'quarter', 'year'];
  const SCALE_LABEL: Record<GanttScale, string> = { day: t('scaleDay'), week: t('scaleWeek'), month: t('scaleMonth'), quarter: t('scaleQuarter'), year: t('scaleYear') };
  const isYearScale = scale === 'year';

  return (
    <div className="flex flex-wrap items-center gap-2 no-print">
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onPan(-1)} title={t('prevPeriod')}>
          <ChevronRight className="h-4 w-4 rotate-180" />
        </Button>
        {isYearScale ? (
          <span className="w-16 text-center text-sm font-semibold">{year}</span>
        ) : (
          <Button variant="outline" size="sm" onClick={onToday}>
            {t('todayButton')}
          </Button>
        )}
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onPan(1)} title={t('nextPeriod')}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        {isYearScale && (
          <Button variant="outline" size="sm" onClick={onToday}>
            {t('todayButton')}
          </Button>
        )}
      </div>

      <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
        {SCALES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScale(s)}
            className={cn('rounded px-2 py-1 text-xs font-medium', scale === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary')}
          >
            {SCALE_LABEL[s]}
          </button>
        ))}
      </div>

      {isYearScale && (
        <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
          {([false, true] as const).map((detail) => (
            <button
              key={String(detail)}
              type="button"
              onClick={() => setYearDetail(detail)}
              className={cn('rounded px-2 py-1 text-xs font-medium', yearDetail === detail ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary')}
            >
              {detail ? t('yearDetail') : t('yearOverview')}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setZoom(Math.max(zoom - 0.25, 0.5))} title={t('zoomOut')}>
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <span className="w-12 text-center text-xs text-muted-foreground">{Math.round(zoom * 100)}%</span>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setZoom(Math.min(zoom + 0.25, 3))} title={t('zoomIn')}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      <input
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder={t('ganttSearchPlaceholder')}
        className="h-8 w-56 rounded-md border border-border bg-background px-2 text-xs"
      />
    </div>
  );
}

function GanttRowView({
  row,
  rowIndex,
  viewFrom,
  pxPerDay,
  now,
  photoByAssembly,
  flashed,
  expanded,
  onToggle,
  registerRef,
  t,
  tp,
}: {
  row: FlatRow;
  rowIndex: number;
  viewFrom: Date;
  pxPerDay: number;
  now: Date;
  photoByAssembly: Record<string, string | undefined>;
  flashed: boolean;
  expanded: boolean;
  onToggle: () => void;
  registerRef: (el: HTMLDivElement | null) => void;
  t: (k: string, values?: Record<string, string | number>) => string;
  tp: (k: string) => string;
}) {
  const { kind, order, item, batch, level } = row;

  let bars: React.ReactNode = null;
  let hasChildren = false;
  let href: string | undefined;
  let label: React.ReactNode;
  let rowProblems: PlannerProblem[] = [];

  if (kind === 'order') {
    const w = orderWindow(order);
    hasChildren = order.items.length > 0 || order.purchaseOrders.length > 0;
    href = `/sales/${order.id}`;
    rowProblems = order.items.flatMap((i) => i.problems);
    const color = order.riskLevel;
    label = (
      <span className="flex items-center gap-1.5 font-semibold">
        {order.orderNumber ? `№${order.orderNumber}` : order.clientName}
        {order.riskLevel !== 'none' && <AlertTriangle className={cn('h-3.5 w-3.5 shrink-0', order.riskLevel === 'critical' ? 'text-destructive' : 'text-warning')} />}
      </span>
    );
    bars = w ? (
      <div
        title={`${order.clientName}: ${w.start.toLocaleDateString()} → ${w.end.toLocaleDateString()}`}
        className={cn('absolute top-[7px] h-5 rounded-r', BAR_COLOR[color])}
        style={{ left: px(w.start, viewFrom, pxPerDay), width: Math.max(px(w.end, viewFrom, pxPerDay) - px(w.start, viewFrom, pxPerDay), 6) }}
      />
    ) : (
      <UnplannedTrack top={7} height={20} />
    );
  } else if (kind === 'po') {
    const po = order.purchaseOrders.find((p) => `po:${p.id}` === row.key);
    if (po) {
      const w = po.expectedDeliveryDate ? { start: new Date(po.orderDate), end: new Date(po.expectedDeliveryDate) } : null;
      label = (
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Truck className="h-3 w-3 shrink-0" />
          {po.supplierName}
        </span>
      );
      href = `/procurement/${po.id}`;
      bars = w ? (
        <div
          title={`${po.supplierName}: ${w.start.toLocaleDateString()} → ${w.end.toLocaleDateString()}`}
          className="absolute top-2.5 h-2.5 rounded-r border-l-4 border-muted-foreground/50 bg-muted"
          style={{ left: px(w.start, viewFrom, pxPerDay), width: Math.max(px(w.end, viewFrom, pxPerDay) - px(w.start, viewFrom, pxPerDay), 6) }}
        />
      ) : (
        <UnplannedTrack top={11} height={6} faint />
      );
    }
  } else if (kind === 'item' && item) {
    const w = itemWindow(item);
    hasChildren = item.batches.length > 0;
    const color = riskOf(item.problems);
    rowProblems = item.problems;
    const photo = photoByAssembly[item.assemblyId];
    label = (
      <Link href={`/sales/${order.id}`} className="flex min-w-0 items-center gap-2 hover:underline">
        <Avatar src={photo} size="md" zoomable={false} className="h-10 w-10 shrink-0" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold leading-tight">
            {item.assemblyName} × {item.qty}
          </span>
          <span className="block truncate text-[10px] font-medium leading-tight text-foreground/70">
            {item.article ? `${t('article')}: ${item.article}` : t('noArticle')}
          </span>
          <span className="block truncate text-[10px] leading-tight text-muted-foreground">
            {t('ordered')} {item.quantitySummary.ordered} · {t('inProduction')} {item.quantitySummary.inProduction} · {t('completed')} {item.quantitySummary.completed} ·{' '}
            <span className="font-medium text-foreground">{t('remaining')} {item.quantitySummary.remaining}</span>
          </span>
        </span>
      </Link>
    );
    bars = w ? (
      <div
        title={`${item.assemblyName}: ${w.start.toLocaleDateString()} → ${w.end.toLocaleDateString()}`}
        className={cn('absolute top-2.5 h-5 rounded-r', BAR_COLOR[color])}
        style={{ left: px(w.start, viewFrom, pxPerDay), width: Math.max(px(w.end, viewFrom, pxPerDay) - px(w.start, viewFrom, pxPerDay), 6) }}
      />
    ) : (
      <UnplannedTrack top={10} height={20} />
    );
  } else if (kind === 'batch' && batch) {
    const planW = batchPlanWindow(batch);
    const factW = batchFactWindow(batch, now);
    hasChildren = batch.stages.length > 0;
    href = `/production/${batch.id}`;
    rowProblems = batch.problems;
    const statusKey = batchStatusKey(batch, now);
    const statusLabel = statusKey === 'OVERDUE' ? t('statusOverdue') : tp(`status${batch.status}`);
    label = (
      <span className="flex flex-col gap-0.5">
        <span className="text-xs font-semibold">
          {t('batch')} · {batch.unitsPlanned} {t('units')}
        </span>
        <StatusBadge statusKey={statusKey} label={statusLabel} />
      </span>
    );
    bars = (
      <>
        {planW ? (
          <div
            title={`${t('planLabel')}: ${planW.start.toLocaleString()} → ${planW.end.toLocaleString()}`}
            className={cn('absolute top-[3px] h-4 rounded-r', BAR_COLOR[riskOf(batch.problems)])}
            style={{ left: px(planW.start, viewFrom, pxPerDay), width: Math.max(px(planW.end, viewFrom, pxPerDay) - px(planW.start, viewFrom, pxPerDay), 8) }}
          />
        ) : (
          <UnplannedTrack top={3} height={16} />
        )}
        {factW && (
          <div
            title={`${t('factLabel')}: ${factW.start.toLocaleString()} → ${batch.fact.endAt ? factW.end.toLocaleString() : '…'}`}
            className="absolute top-[21px] h-4 rounded-r border-l-4 border-foreground bg-foreground/85 shadow-sm"
            style={{ left: px(factW.start, viewFrom, pxPerDay), width: Math.max(px(factW.end, viewFrom, pxPerDay) - px(factW.start, viewFrom, pxPerDay), 6) }}
          />
        )}
      </>
    );
  } else if (kind === 'stage' && batch) {
    const stage = batch.stages.find((s) => `stage:${s.id}:${batch.id}` === row.key);
    const w = stage?.plan ? toWindow(stage.plan.startAt, stage.plan.endAt) : null;
    label = (
      <span className={cn('text-xs', !w && 'italic text-muted-foreground')}>
        {stage?.name}
        {!w && ` (${t('notPlanned')})`}
      </span>
    );
    bars = w ? (
      <div
        title={`${stage?.name}: ${w.start.toLocaleString()} → ${w.end.toLocaleString()}`}
        className="absolute top-2 h-4 rounded-r border-l-4 border-primary bg-primary/80 shadow-sm"
        style={{ left: px(w.start, viewFrom, pxPerDay), width: Math.max(px(w.end, viewFrom, pxPerDay) - px(w.start, viewFrom, pxPerDay), 6) }}
      />
    ) : (
      <UnplannedTrack top={2} height={16} />
    );
  }

  return (
    <div
      ref={registerRef}
      className={cn(
        'relative flex border-b border-border/60 transition-colors',
        rowIndex % 2 === 1 && 'bg-muted/20',
        kind === 'item' && 'bg-muted/40',
        flashed && 'bg-warning/30',
        kind === 'order' && 'bg-card font-semibold',
      )}
      style={{ height: kind === 'item' ? ROW_HEIGHT + 12 : kind === 'batch' ? ROW_HEIGHT + 6 : ROW_HEIGHT }}
    >
      <div
        className={cn('sticky left-0 z-10 flex shrink-0 items-center gap-1 overflow-hidden border-r border-border pr-2 text-xs', LEVEL_ACCENT[level])}
        style={{ width: LABEL_WIDTH, paddingLeft: 8 + level * 16, backgroundColor: 'hsl(var(--card))' }}
      >
        {hasChildren ? (
          <button type="button" onClick={onToggle} className="shrink-0 rounded hover:bg-secondary">
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {href ? (
          <Link href={href} className="min-w-0 flex-1 truncate text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
            {label}
          </Link>
        ) : (
          <span className="min-w-0 flex-1 truncate">{label}</span>
        )}
        {rowProblems.length > 0 && (
          <span title={rowProblems[0].message}>
            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
          </span>
        )}
      </div>
      <div className="relative flex-1">{bars}</div>
    </div>
  );
}
