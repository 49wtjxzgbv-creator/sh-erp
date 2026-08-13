'use client';

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronRight, AlertTriangle, Truck, Minus, Plus } from 'lucide-react';
import { timelineDayMarks, timelineHourMarks, timelineMonthMarks, timelineWeekMarks, isWeekend } from '@/lib/timeline-utils';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import type { PlannerBatchNode, PlannerItemNode, PlannerOrderNode, PlannerProblem, PlannerStageNode } from '@/lib/api-client/planner';
import type { ProductionStage } from '@/lib/api-client/production';

/**
 * A production dispatcher SWIMLANE board — not a WBS-style hierarchical
 * Gantt. Rows are the company's real ProductionStage lanes (Заготівля /
 * Обробка / Збірка / Контроль / ...), plus Закупівлі and Відвантаження —
 * never Order/Item/Batch as their own rows. A work-card is one
 * (batch, stage) pair, physically positioned and sized by that stage's own
 * ProductionOrderStagePlan window, floating inside its lane; the same
 * batch appears as a separate card in each lane it has touched, so the
 * board reads left-to-right as an actual production flow ("Партія #501
 * passes through Заготівля, then Обробка, then..."), not as a list of
 * nested rows. Cards from different batches that overlap in time within
 * the same lane get packed into extra sub-rows (packCards, the same
 * greedy interval-scheduling technique as dashboard/operations-timeline.
 * tsx's packRows) — a lane only grows taller where it actually needs to.
 *
 * No Gantt library — hand-built percent/px positioning, same technique as
 * lib/timeline-utils.ts's other consumers, with real pixel widths (not
 * percentages) so zoom has something real to change.
 */

export type GanttScale = 'day' | 'week' | 'month' | 'quarter' | 'year';

const BASE_PX_PER_DAY: Record<Exclude<GanttScale, 'year'>, number> = { day: 480, week: 34, month: 11, quarter: 3.4 };
const WINDOW_DAYS: Record<Exclude<GanttScale, 'year'>, number> = { day: 10, week: 90, month: 420, quarter: 900 };
const PAN_STEP_DAYS: Record<Exclude<GanttScale, 'year'>, number> = { day: 3, week: 21, month: 90, quarter: 180 };
/** Two distinct zoom levels for the Year scale — an overview (12 month bars) and a detail level (month + week gridlines) — not just a shrunk Month view. */
const YEAR_PX_PER_DAY = { overview: 2.4, detail: 9 };

function daysInYear(year: number): number {
  return (new Date(year, 11, 31).getTime() - new Date(year, 0, 1).getTime()) / 86400000 + 1;
}

const LABEL_WIDTH = 170;
const CARD_ROW_HEIGHT = 54;
const MARKER_ROW_HEIGHT = 34;
const CARD_GAP = 3;
const RICH_CARD_MIN_WIDTH = 92;

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

type RiskColor = 'none' | 'warning' | 'critical';
function riskOf(problems: PlannerProblem[]): RiskColor {
  if (problems.some((p) => p.severity === 'critical')) return 'critical';
  if (problems.some((p) => p.severity === 'warning')) return 'warning';
  return 'none';
}

// Physical index-card look — a neutral, raised card face with a coloured
// status spine, not a flat solid-colour block. Depth (shadow + hover lift)
// is what reads as "a card sitting on the board," the colour on its own
// only reads as risk severity.
const CARD_COLOR: Record<RiskColor, { border: string; icon: string }> = {
  none: { border: 'border-l-muted-foreground/50', icon: 'text-muted-foreground' },
  warning: { border: 'border-l-warning', icon: 'text-warning' },
  critical: { border: 'border-l-destructive', icon: 'text-destructive' },
};

export function px(day: Date, viewFrom: Date, pxPerDay: number): number {
  return ((day.getTime() - viewFrom.getTime()) / 86400000) * pxPerDay;
}

/** Greedy interval-scheduling packing — same algorithm as dashboard/operations-timeline.tsx's packRows, applied per-lane instead of per-group. */
function packCards<T extends { window: Window }>(cards: T[]): T[][] {
  const sorted = [...cards].sort((a, b) => a.window.start.getTime() - b.window.start.getTime());
  const rows: T[][] = [];
  for (const c of sorted) {
    const row = rows.find((r) => r[r.length - 1].window.end.getTime() <= c.window.start.getTime());
    if (row) row.push(c);
    else rows.push([c]);
  }
  return rows;
}

interface StageCard {
  key: string;
  order: PlannerOrderNode;
  item: PlannerItemNode;
  batch: PlannerBatchNode;
  stage: PlannerStageNode;
  window: Window;
  planWindow: Window | null;
  factWindow: Window | null;
}

interface PurchaseCard {
  key: string;
  order: PlannerOrderNode;
  poId: string;
  supplierName: string;
  status: string;
  window: Window;
}

interface ShipmentMarker {
  key: string;
  order: PlannerOrderNode;
  date: Date;
  kind: 'plan' | 'fact';
}

/** One lane per real ProductionStage (never invented names) + Закупівлі + Відвантаження. */
type Lane =
  | { key: string; kind: 'stage'; label: string; stage: ProductionStage; cards: StageCard[] }
  | { key: string; kind: 'purchases'; label: string; cards: PurchaseCard[] }
  | { key: string; kind: 'shipments'; label: string; markers: ShipmentMarker[] };

function buildLanes(orders: PlannerOrderNode[], stages: ProductionStage[], now: Date): Lane[] {
  const stageCardsById = new Map<string, StageCard[]>();
  for (const s of stages) stageCardsById.set(s.id, []);

  for (const order of orders) {
    for (const item of order.items) {
      for (const batch of item.batches) {
        for (const stage of batch.stages) {
          const bucket = stageCardsById.get(stage.id);
          if (!bucket) continue; // stage removed from company catalogue since this plan row was made — edge case, skip rather than invent a lane
          const planWindow = stage.plan ? toWindow(stage.plan.startAt, stage.plan.endAt) : null;
          const factWindow = stage.fact.endAt
            ? toWindow(stage.fact.startAt, stage.fact.endAt)
            : stage.fact.startAt
              ? { start: new Date(stage.fact.startAt), end: now }
              : null;
          const window = planWindow ?? factWindow;
          if (!window) continue; // nothing to position — never invent a slot
          bucket.push({ key: `${batch.id}:${stage.id}`, order, item, batch, stage, window, planWindow, factWindow });
        }
      }
    }
  }

  const stageLanes: Lane[] = stages.map((s) => ({ key: `stage:${s.id}`, kind: 'stage', label: s.name, stage: s, cards: stageCardsById.get(s.id) ?? [] }));

  const purchaseCards: PurchaseCard[] = [];
  for (const order of orders) {
    for (const po of order.purchaseOrders) {
      const w = po.expectedDeliveryDate ? toWindow(po.orderDate, po.expectedDeliveryDate) : null;
      if (!w) continue;
      purchaseCards.push({ key: `po:${po.id}`, order, poId: po.id, supplierName: po.supplierName, status: po.status, window: w });
    }
  }

  const shipmentMarkers: ShipmentMarker[] = [];
  for (const order of orders) {
    if (order.plan.shipmentAt) shipmentMarkers.push({ key: `ship-plan:${order.id}`, order, date: new Date(order.plan.shipmentAt), kind: 'plan' });
    for (const s of order.shipments) {
      const d = s.shipDate ?? s.deliveryDate;
      if (d) shipmentMarkers.push({ key: `ship-fact:${s.id}`, order, date: new Date(d), kind: 'fact' });
    }
  }

  return [...stageLanes, { key: 'purchases', kind: 'purchases', label: '', cards: purchaseCards }, { key: 'shipments', kind: 'shipments', label: '', markers: shipmentMarkers }];
}

export interface PlannerGanttHandle {
  /** Scrolls to and flashes every card belonging to the given entity — used by the problems panel's "jump to card" click. */
  revealEntity: (entityType: PlannerProblem['entityType'], entityId: string, orderId: string) => void;
}

function shortId(id: string): string {
  return id.slice(0, 4).toUpperCase();
}

function StageCardBox({
  card,
  viewFrom,
  pxPerDay,
  top,
  photoByAssembly,
  flashed,
  registerRef,
  t,
}: {
  card: StageCard;
  viewFrom: Date;
  pxPerDay: number;
  top: number;
  photoByAssembly: Record<string, string | undefined>;
  flashed: boolean;
  registerRef: (el: HTMLAnchorElement | null) => void;
  t: (k: string) => string;
}) {
  const left = px(card.window.start, viewFrom, pxPerDay);
  const width = Math.max(px(card.window.end, viewFrom, pxPerDay) - left, 8);
  const rich = width >= RICH_CARD_MIN_WIDTH;
  const color = riskOf(card.batch.problems);
  const photo = photoByAssembly[card.item.assemblyId];

  let progressPct: number | null = null;
  if (card.planWindow && card.factWindow) {
    const total = card.planWindow.end.getTime() - card.planWindow.start.getTime();
    if (total > 0) {
      const doneStart = Math.max(card.factWindow.start.getTime(), card.planWindow.start.getTime());
      const doneEnd = Math.min(card.factWindow.end.getTime(), card.planWindow.end.getTime());
      progressPct = Math.max(0, Math.min(100, ((doneEnd - doneStart) / total) * 100));
    }
  } else if (!card.planWindow && card.factWindow) {
    progressPct = 100;
  }

  const tooltip = `${card.item.assemblyName} · ${card.batch.unitsPlanned} шт. · ${card.stage.name}\n${card.window.start.toLocaleString()} → ${card.window.end.toLocaleString()}`;

  return (
    <Link
      href={`/production/${card.batch.id}`}
      ref={registerRef}
      title={tooltip}
      className={cn(
        'absolute overflow-hidden rounded-md border border-l-4 border-border/80 bg-card shadow-[0_1px_2px_rgba(0,0,0,0.08),0_2px_5px_rgba(0,0,0,0.08)]',
        'transition-all duration-150 hover:-translate-y-px hover:shadow-[0_2px_4px_rgba(0,0,0,0.1),0_6px_14px_rgba(0,0,0,0.14)]',
        CARD_COLOR[color].border,
        flashed && 'ring-2 ring-warning ring-offset-1',
      )}
      style={{ left, width, top, height: CARD_ROW_HEIGHT - CARD_GAP }}
    >
      {progressPct != null && <div className="absolute inset-y-0 left-0 bg-primary/12" style={{ width: `${progressPct}%` }} />}
      {rich ? (
        <div className="relative flex h-full items-center gap-1.5 px-1.5 py-1">
          <Avatar src={photo} size="sm" zoomable={false} className="h-8 w-8 shrink-0 ring-1 ring-border" />
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[10px] font-semibold text-foreground">{card.item.assemblyName}</p>
            <p className="truncate text-[9px] text-muted-foreground">{card.item.article ?? t('noArticle')}</p>
            <p className="truncate text-[9px] text-muted-foreground">#{shortId(card.batch.id)} · {card.batch.unitsPlanned} шт.</p>
          </div>
        </div>
      ) : (
        <div className="relative flex h-full items-center px-1">
          <p className="truncate text-[9px] font-medium text-foreground">{card.item.assemblyName} · #{shortId(card.batch.id)}</p>
        </div>
      )}
      {color !== 'none' && <AlertTriangle className={cn('absolute right-1 top-1 h-3 w-3', CARD_COLOR[color].icon)} />}
    </Link>
  );
}

function PurchaseCardBox({ card, viewFrom, pxPerDay, top, flashed, registerRef }: { card: PurchaseCard; viewFrom: Date; pxPerDay: number; top: number; flashed: boolean; registerRef: (el: HTMLAnchorElement | null) => void }) {
  const left = px(card.window.start, viewFrom, pxPerDay);
  const width = Math.max(px(card.window.end, viewFrom, pxPerDay) - left, 8);
  return (
    <Link
      href={`/procurement/${card.poId}`}
      ref={registerRef}
      title={`${card.supplierName} (${card.order.clientName}): ${card.window.start.toLocaleDateString()} → ${card.window.end.toLocaleDateString()}`}
      className={cn(
        'absolute flex items-center gap-1 overflow-hidden rounded-md border border-l-4 border-border/80 border-l-muted-foreground/60 bg-card px-1.5',
        'shadow-[0_1px_2px_rgba(0,0,0,0.08)] transition-all duration-150 hover:-translate-y-px hover:shadow-[0_2px_6px_rgba(0,0,0,0.12)]',
        flashed && 'ring-2 ring-warning ring-offset-1',
      )}
      style={{ left, width, top, height: MARKER_ROW_HEIGHT - CARD_GAP }}
    >
      <Truck className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="truncate text-[9px]">{card.supplierName}</span>
    </Link>
  );
}

function ShipmentMarkerBox({ marker, viewFrom, pxPerDay, top, flashed, registerRef }: { marker: ShipmentMarker; viewFrom: Date; pxPerDay: number; top: number; flashed: boolean; registerRef: (el: HTMLAnchorElement | null) => void }) {
  const left = px(marker.date, viewFrom, pxPerDay);
  return (
    <Link
      href={`/sales/${marker.order.id}`}
      ref={registerRef}
      title={`${marker.order.clientName}: ${marker.date.toLocaleDateString()}`}
      className={cn('absolute flex items-center gap-1', flashed && 'rounded ring-2 ring-warning ring-offset-1')}
      style={{ left: left - 5, top, width: 130, height: MARKER_ROW_HEIGHT - CARD_GAP }}
    >
      <span className={cn('h-2.5 w-2.5 rotate-45 shrink-0', marker.kind === 'fact' ? 'bg-success' : 'border-2 border-primary bg-background')} />
      <span className="truncate text-[9px] text-muted-foreground">{marker.order.orderNumber ? `№${marker.order.orderNumber}` : marker.order.clientName}</span>
    </Link>
  );
}

function LaneRow({
  lane,
  laneIndex,
  viewFrom,
  pxPerDay,
  photoByAssembly,
  flashKey,
  registerCardRef,
  t,
}: {
  lane: Lane;
  laneIndex: number;
  viewFrom: Date;
  pxPerDay: number;
  photoByAssembly: Record<string, string | undefined>;
  flashKey: string | null;
  registerCardRef: (key: string, el: HTMLAnchorElement | null) => void;
  t: (k: string) => string;
}) {
  let packed: unknown[][];
  let rowHeight: number;
  if (lane.kind === 'stage') {
    packed = packCards(lane.cards);
    rowHeight = CARD_ROW_HEIGHT;
  } else if (lane.kind === 'purchases') {
    packed = packCards(lane.cards);
    rowHeight = MARKER_ROW_HEIGHT;
  } else {
    // Milestones are points, not ranges — pack by a tiny synthetic window so same-day markers still get separate sub-rows instead of overlapping.
    packed = packCards(lane.markers.map((m) => ({ ...m, window: { start: m.date, end: new Date(m.date.getTime() + 3 * 86400000) } })));
    rowHeight = MARKER_ROW_HEIGHT;
  }
  const laneHeight = Math.max(packed.length, 1) * rowHeight;

  return (
    <div className={cn('relative flex border-b border-border/60', laneIndex % 2 === 1 && 'bg-muted/20')} style={{ height: laneHeight }}>
      <div className="sticky left-0 z-10 flex shrink-0 items-center border-r border-border px-2 text-xs font-semibold" style={{ width: LABEL_WIDTH, backgroundColor: 'hsl(var(--card))' }}>
        {lane.kind === 'stage' ? lane.label : lane.kind === 'purchases' ? t('materials') : t('shipmentsLane')}
      </div>
      <div className="relative flex-1">
        {packed.map((row, subRowIndex) =>
          row.map((c) => {
            const top = subRowIndex * rowHeight + CARD_GAP;
            if (lane.kind === 'stage') {
              const card = c as StageCard;
              return <StageCardBox key={card.key} card={card} viewFrom={viewFrom} pxPerDay={pxPerDay} top={top} photoByAssembly={photoByAssembly} flashed={flashKey === card.key} registerRef={(el) => registerCardRef(card.key, el)} t={t} />;
            }
            if (lane.kind === 'purchases') {
              const card = c as PurchaseCard;
              return <PurchaseCardBox key={card.key} card={card} viewFrom={viewFrom} pxPerDay={pxPerDay} top={top} flashed={flashKey === card.key} registerRef={(el) => registerCardRef(card.key, el)} />;
            }
            const marker = c as ShipmentMarker;
            return <ShipmentMarkerBox key={marker.key} marker={marker} viewFrom={viewFrom} pxPerDay={pxPerDay} top={top} flashed={flashKey === marker.key} registerRef={(el) => registerCardRef(marker.key, el)} />;
          }),
        )}
      </div>
    </div>
  );
}

export const PlannerGanttChart = forwardRef<
  PlannerGanttHandle,
  { orders: PlannerOrderNode[]; stages: ProductionStage[]; photoByAssembly: Record<string, string | undefined>; year: number; onYearChange: (y: number) => void }
>(function PlannerGanttChart({ orders, stages, photoByAssembly, year, onYearChange }, ref) {
  const t = useTranslations('planner');
  const now = useMemo(() => new Date(), []);

  const [scale, setScale] = useState<GanttScale>('month');
  const [zoom, setZoom] = useState(1);
  const [anchor, setAnchor] = useState(now);
  const [yearDetail, setYearDetail] = useState(false);
  const [search, setSearch] = useState('');
  const [flashKey, setFlashKey] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());

  const isYearScale = scale === 'year';
  const pxPerDay = (isYearScale ? YEAR_PX_PER_DAY[yearDetail ? 'detail' : 'overview'] : BASE_PX_PER_DAY[scale]) * zoom;
  const windowDays = isYearScale ? daysInYear(year) : WINDOW_DAYS[scale];
  const viewFrom = useMemo(() => (isYearScale ? new Date(year, 0, 1) : new Date(anchor.getTime() - (windowDays / 2) * 86400000)), [isYearScale, year, anchor, windowDays]);
  const viewTo = useMemo(() => (isYearScale ? new Date(year, 11, 31, 23, 59, 59) : new Date(anchor.getTime() + (windowDays / 2) * 86400000)), [isYearScale, year, anchor, windowDays]);
  const canvasWidth = Math.max(windowDays * pxPerDay, 600);

  const lanes = useMemo(() => buildLanes(orders, stages, now), [orders, stages, now]);

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

  function flashAndScroll(keys: string[]) {
    if (keys.length === 0) return;
    setFlashKey(keys[0]);
    window.setTimeout(() => setFlashKey(null), 2200);
    window.setTimeout(() => {
      const el = cardRefs.current.get(keys[0]);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }, 50);
  }

  useImperativeHandle(ref, () => ({
    revealEntity(entityType, entityId, orderId) {
      if (entityType === 'ProductionOrder') {
        flashAndScroll([...cardRefs.current.keys()].filter((k) => k.startsWith(`${entityId}:`)));
      } else if (entityType === 'CustomerOrderItem') {
        const order = orders.find((o) => o.id === orderId);
        const item = order?.items.find((i) => i.id === entityId);
        const batchIds = item ? item.batches.map((b) => b.id) : [];
        flashAndScroll([...cardRefs.current.keys()].filter((k) => batchIds.some((id) => k.startsWith(`${id}:`))));
      } else if (entityType === 'PurchaseOrder') {
        flashAndScroll([`po:${entityId}`]);
      } else if (entityType === 'CustomerOrder') {
        flashAndScroll([`ship-plan:${orderId}`, `ship-fact:${orderId}`]);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }));

  function runSearch(query: string) {
    setSearch(query);
    const q = query.trim().toLowerCase();
    if (!q) return;
    for (const lane of lanes) {
      if (lane.kind === 'stage') {
        const match = lane.cards.find(
          (c) => c.item.assemblyName.toLowerCase().includes(q) || (c.item.article ?? '').toLowerCase().includes(q) || (c.order.orderNumber ?? '').toLowerCase().includes(q) || c.order.clientName.toLowerCase().includes(q),
        );
        if (match) return flashAndScroll([match.key]);
      } else if (lane.kind === 'purchases') {
        const match = lane.cards.find((c) => c.supplierName.toLowerCase().includes(q));
        if (match) return flashAndScroll([match.key]);
      }
    }
  }

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

      <div ref={scrollRef} className="relative max-h-[75vh] overflow-auto rounded-lg border border-border">
        <div className="relative" style={{ width: LABEL_WIDTH + canvasWidth }}>
          {/* Sticky timeline header */}
          <div className="sticky top-0 z-20 flex border-b border-border bg-card">
            <div className="sticky left-0 z-30 flex shrink-0 items-end border-r border-border bg-card px-2 pb-1 text-xs font-semibold text-muted-foreground" style={{ width: LABEL_WIDTH }}>
              {t('productionLabel')}
            </div>
            <div className="relative shrink-0" style={{ width: canvasWidth, height: scale === 'day' ? 40 : 24 }}>
              {months.map((m, i) => (
                <span key={i} className="absolute top-0 whitespace-nowrap text-xs font-medium" style={{ left: px(m.start, viewFrom, pxPerDay) + 4 }}>
                  {m.label}
                </span>
              ))}
              {scale === 'day' &&
                (() => {
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
                isWeekend(d) ? <div key={i} className="absolute inset-y-0 bg-muted/50" style={{ left: px(d, viewFrom, pxPerDay), width: pxPerDay }} /> : null,
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

          {/* Lanes */}
          <div className="relative">
            {lanes.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">{t('noOrders')}</p>}
            {lanes.map((lane, i) => (
              <LaneRow
                key={lane.key}
                lane={lane}
                laneIndex={i}
                viewFrom={viewFrom}
                pxPerDay={pxPerDay}
                photoByAssembly={photoByAssembly}
                flashKey={flashKey}
                registerCardRef={(key, el) => {
                  if (el) cardRefs.current.set(key, el);
                  else cardRefs.current.delete(key);
                }}
                t={t}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

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
