'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronRight, AlertCircle, AlertTriangle, Info, Search } from 'lucide-react';
import { usePlannerBoard, usePlannerKpis } from '@/lib/hooks/use-planner';
import { PlannerGanttChart } from '@/components/domain/planner/planner-gantt';
import { LoadingBlock } from '@/components/ui/loading-block';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type {
  PlannerBatchNode,
  PlannerItemNode,
  PlannerKpis,
  PlannerOrderNode,
  PlannerProblem,
  QueryPlannerBoardInput,
} from '@/lib/api-client/planner';

/**
 * План-графік — the production dispatcher center, not a decorative
 * calendar (see the confirmed plan: /Users/illa/.claude/plans/
 * synthetic-knitting-kahn.md). Two views over the same real hierarchy —
 * CustomerOrder → CustomerOrderItem → ProductionOrder batch → stage plan:
 * PlannerGanttChart (components/domain/planner/planner-gantt.tsx) is the
 * actual percent-positioned timeline diagram (same technique as the
 * Dashboard's operations-timeline.tsx), and the expandable cards below it
 * carry the full text detail (quantity summary, all four order-level
 * planned dates, purchase-order suppliers) that doesn't fit in a Gantt
 * row's label. Every plan/fact date, quantity, and problem shown in either
 * view comes straight from planner-board.service.ts's real-entity
 * computation — nothing invented. Drag-and-drop editing directly on the
 * chart is explicitly Phase B, deferred per the confirmed plan.
 */

const RISK_VARIANT: Record<PlannerOrderNode['riskLevel'], 'secondary' | 'warning' | 'destructive'> = {
  none: 'secondary',
  warning: 'warning',
  critical: 'destructive',
};

const BATCH_STATUS_VARIANT: Record<PlannerBatchNode['status'], 'secondary' | 'warning' | 'success' | 'destructive'> = {
  PLANNED: 'secondary',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'destructive',
};

const SEVERITY_ICON: Record<PlannerProblem['severity'], typeof AlertCircle> = {
  critical: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const SEVERITY_COLOR: Record<PlannerProblem['severity'], string> = {
  critical: 'text-destructive',
  warning: 'text-warning',
  info: 'text-muted-foreground',
};

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '';
}

function PlanFactDates({ plan, fact, notPlannedLabel, planLabel, factLabel }: { plan: { startAt: string | null; endAt: string | null }; fact?: { startAt: string | null; endAt: string | null }; notPlannedLabel: string; planLabel: string; factLabel: string }) {
  return (
    <div className="flex flex-col gap-0.5 text-xs">
      <span className="text-muted-foreground">
        {planLabel}: {plan.startAt || plan.endAt ? `${fmtDate(plan.startAt)} → ${fmtDate(plan.endAt)}` : notPlannedLabel}
      </span>
      {fact && (fact.startAt || fact.endAt) && (
        <span className="font-medium">
          {factLabel}: {fmtDate(fact.startAt)} → {fact.endAt ? fmtDate(fact.endAt) : '…'}
        </span>
      )}
    </div>
  );
}

function entityHref(problem: PlannerProblem): string {
  switch (problem.entityType) {
    case 'CustomerOrder':
    case 'CustomerOrderItem':
      return `/sales/${problem.orderId}`;
    case 'ProductionOrder':
      return `/production/${problem.entityId}`;
    case 'PurchaseOrder':
      return `/procurement/${problem.entityId}`;
    case 'FinishedGood':
      return `/production/finished-goods/${problem.entityId}`;
    case 'Employee':
      return `/hr/${problem.entityId}`;
    default:
      return `/sales/${problem.orderId}`;
  }
}

function ProblemsPanel({ problems }: { problems: PlannerProblem[] }) {
  const t = useTranslations('planner');
  const sorted = useMemo(() => {
    const rank: Record<PlannerProblem['severity'], number> = { critical: 0, warning: 1, info: 2 };
    return [...problems].sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 30);
  }, [problems]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('problemsPanelTitle')} ({problems.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('problemsEmpty')}</p>
        ) : (
          <ul className="space-y-2">
            {sorted.map((p, i) => {
              const Icon = SEVERITY_ICON[p.severity];
              return (
                <li key={`${p.code}-${p.entityId}-${i}`}>
                  <Link href={entityHref(p)} className="flex items-start gap-2 rounded-md p-1.5 text-sm hover:bg-secondary">
                    <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', SEVERITY_COLOR[p.severity])} />
                    <span>{p.message}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function StageRow({ stage, notPlannedLabel }: { stage: PlannerBatchNode['stages'][number]; notPlannedLabel: string }) {
  return (
    <div className="flex items-center justify-between rounded border border-border/60 px-2 py-1 text-xs">
      <span className="font-medium">{stage.name}</span>
      <span className={cn(!stage.plan && 'text-muted-foreground italic')}>
        {stage.plan ? `${fmtDate(stage.plan.startAt)} → ${fmtDate(stage.plan.endAt)}` : notPlannedLabel}
      </span>
    </div>
  );
}

function BatchRow({ batch }: { batch: PlannerBatchNode }) {
  const t = useTranslations('planner');
  const tp = useTranslations('production');
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/20 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/production/${batch.id}`} className="text-sm font-medium text-primary hover:underline">
          {t('batch')} · {batch.unitsPlanned} {t('units')}
        </Link>
        <Badge variant={BATCH_STATUS_VARIANT[batch.status]}>{tp(`status${batch.status}`)}</Badge>
      </div>
      <PlanFactDates plan={batch.plan} fact={batch.fact} notPlannedLabel={t('notPlanned')} planLabel={t('planLabel')} factLabel={t('factLabel')} />
      {batch.stages.length > 0 && (
        <div className="space-y-1">
          {batch.stages.map((stage) => (
            <StageRow key={stage.id} stage={stage} notPlannedLabel={t('notPlanned')} />
          ))}
        </div>
      )}
      {batch.problems.length > 0 && (
        <ul className="space-y-1">
          {batch.problems.map((p, i) => {
            const Icon = SEVERITY_ICON[p.severity];
            return (
              <li key={i} className={cn('flex items-start gap-1.5 text-xs', SEVERITY_COLOR[p.severity])}>
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{p.message}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ItemRow({ item }: { item: PlannerItemNode }) {
  const t = useTranslations('planner');
  const ts = useTranslations('sales');
  const [open, setOpen] = useState(false);
  const s = item.quantitySummary;

  return (
    <div className="rounded-md border border-border">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-secondary/50">
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          <span className="text-sm font-medium">{item.assemblyName} × {item.qty}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{t('ordered')}: {s.ordered}</span>
          <span>{t('inProduction')}: {s.inProduction}</span>
          <span>{t('completed')}: {s.completed}</span>
          <span className="font-medium text-foreground">{t('remaining')}: {s.remaining}</span>
          {item.problems.length > 0 && <AlertTriangle className="h-4 w-4 text-warning" />}
        </div>
      </button>
      {open && (
        <div className="space-y-2 border-t border-border p-3">
          <PlanFactDates plan={{ startAt: item.plan.startAt, endAt: item.plan.endAt }} notPlannedLabel={t('notPlanned')} planLabel={t('planLabel')} factLabel={t('factLabel')} />
          {item.plan.deadline && <p className="text-xs text-muted-foreground">{ts('deadline')}: {fmtDate(item.plan.deadline)}</p>}
          {item.batches.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('notPlanned')}</p>
          ) : (
            <div className="space-y-2">
              {item.batches.map((b) => (
                <BatchRow key={b.id} batch={b} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OrderCard({ order }: { order: PlannerOrderNode }) {
  const t = useTranslations('planner');
  const ts = useTranslations('sales');
  const [open, setOpen] = useState(order.riskLevel !== 'none');

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 text-left">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <Link href={`/sales/${order.id}`} className="text-base font-semibold text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
            {order.orderNumber ? `№${order.orderNumber} — ` : ''}{order.clientName}
          </Link>
          <Badge variant="outline">{ts(`orderStatus${order.status}`)}</Badge>
        </button>
        <Badge variant={RISK_VARIANT[order.riskLevel]}>{t(`risk${order.riskLevel === 'none' ? 'None' : order.riskLevel === 'warning' ? 'Warning' : 'Critical'}`)}</Badge>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">{ts('plannedStartAt')}</p>
              <p className="text-sm">{order.plan.startAt ? fmtDate(order.plan.startAt) : t('notPlanned')}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{ts('plannedCompletionAt')}</p>
              <p className="text-sm">{order.plan.completionAt ? fmtDate(order.plan.completionAt) : t('notPlanned')}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{ts('plannedShipmentAt')}</p>
              <p className="text-sm">{order.plan.shipmentAt ? fmtDate(order.plan.shipmentAt) : t('notPlanned')}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{ts('deadline')}</p>
              <p className="text-sm">{order.deadline ? fmtDate(order.deadline) : t('notPlanned')}</p>
            </div>
          </div>

          <div className="space-y-2">
            {order.items.map((item) => (
              <ItemRow key={item.id} item={item} />
            ))}
          </div>

          {order.purchaseOrders.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">{t('materials')}</p>
              <div className="flex flex-wrap gap-2">
                {order.purchaseOrders.map((po) => (
                  <Link key={po.id} href={`/procurement/${po.id}`}>
                    <Badge variant={po.status === 'DELIVERED' ? 'success' : 'outline'}>
                      {po.supplierName} — {po.expectedDeliveryDate ? fmtDate(po.expectedDeliveryDate) : t('notPlanned')}
                    </Badge>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export default function PlannerPage() {
  const t = useTranslations('planner');
  const ts = useTranslations('sales');

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [problemOnly, setProblemOnly] = useState(false);

  const query: QueryPlannerBoardInput = {
    search: search || undefined,
    status,
    problem: problemOnly ? 'true' : undefined,
  };

  const { data: board, isLoading } = usePlannerBoard(query);
  const { data: kpis } = usePlannerKpis(query);

  const kpiCards: { key: keyof PlannerKpis; label: string; warn?: boolean }[] = kpis
    ? [
        { key: 'ordersInWork', label: t('kpiOrdersInWork') },
        { key: 'itemsInWork', label: t('kpiItemsInWork') },
        { key: 'batchesInWork', label: t('kpiBatchesInWork') },
        { key: 'stagesInWork', label: t('kpiStagesInWork') },
        { key: 'itemsWithProblems', label: t('kpiItemsWithProblems'), warn: kpis.itemsWithProblems > 0 },
        { key: 'itemsBlockedByMaterials', label: t('kpiItemsBlockedByMaterials'), warn: kpis.itemsBlockedByMaterials > 0 },
        { key: 'overduePurchases', label: t('kpiOverduePurchases'), warn: kpis.overduePurchases > 0 },
        { key: 'ordersAtRisk', label: t('kpiOrdersAtRisk'), warn: kpis.ordersAtRisk > 0 },
        { key: 'finishedGoodsAwaitingShipment', label: t('kpiFinishedGoodsAwaitingShipment') },
      ]
    : [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {kpiCards.map(({ key, label, warn }) => (
          <button
            key={key}
            type="button"
            onClick={() => { if (key === 'itemsWithProblems' || key === 'ordersAtRisk' || key === 'itemsBlockedByMaterials') setProblemOnly(true); }}
            className="text-left"
          >
            <Card className={cn('transition-colors hover:border-primary/50', warn && 'border-destructive/50 bg-destructive/5')}>
              <CardContent className="py-4">
                <p className={cn('text-2xl font-semibold', warn && 'text-destructive')}>{kpis?.[key] ?? '—'}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-4">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder={t('filterSearch')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={status ?? '__all__'} onValueChange={(v) => setStatus(v === '__all__' ? undefined : v)}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder={t('filterAllStatuses')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t('filterAllStatuses')}</SelectItem>
              <SelectItem value="NEW">{ts('orderStatusNEW')}</SelectItem>
              <SelectItem value="IN_PRODUCTION">{ts('orderStatusIN_PRODUCTION')}</SelectItem>
              <SelectItem value="COMPLETED">{ts('orderStatusCOMPLETED')}</SelectItem>
              <SelectItem value="CANCELLED">{ts('orderStatusCANCELLED')}</SelectItem>
            </SelectContent>
          </Select>
          <Button variant={problemOnly ? 'default' : 'outline'} size="sm" onClick={() => setProblemOnly((v) => !v)}>
            {t('filterOnlyProblems')}
          </Button>
        </CardContent>
      </Card>

      {board && <ProblemsPanel problems={board.problems} />}

      {isLoading || !board ? (
        <LoadingBlock />
      ) : board.orders.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t('noOrders')}</p>
      ) : (
        <>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm border border-foreground/40 opacity-60" />{t('planLabel')}</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-sm bg-foreground/70" />{t('factLabel')}</span>
          </div>
          <PlannerGanttChart orders={board.orders} from={new Date(board.from)} to={new Date(board.to)} />
          <div className="space-y-3">
            {board.orders.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
