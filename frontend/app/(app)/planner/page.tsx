'use client';

import { useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, AlertTriangle, Info, Search, ExternalLink, Printer, ChevronRight, Plus, Minus, ColumnsIcon } from 'lucide-react';
import Link from 'next/link';
import { usePlannerBoard, usePlannerKpis } from '@/lib/hooks/use-planner';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { useSuppliers } from '@/lib/hooks/use-procurement';
import { useProductionStages } from '@/lib/hooks/use-production';
import { PlannerGanttChart, type PlannerGanttHandle } from '@/components/domain/planner/planner-gantt';
import { PlannerResourcesView } from '@/components/domain/planner/planner-resources';
import { PlannerOrdersTimelineView } from '@/components/domain/planner/planner-orders-timeline';
import { PlannerGanttPrintTable } from '@/components/domain/planner/planner-gantt-print';
import { PlannerOrdersPrintTable, PlannerOrdersPrintLegend } from '@/components/domain/planner/planner-orders-print';
import { PrintArea, PrintDocumentHeader, PreviewButton } from '@/components/domain/print/print-area';
import { startOfWeek, startOfMonth } from '@/lib/timeline-utils';
import { LoadingBlock } from '@/components/ui/loading-block';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { LearnThisButton } from '@/components/domain/training/learn-this-button';
import { cn } from '@/lib/utils';
import type { PlannerKpis, PlannerProblem, QueryPlannerBoardInput } from '@/lib/api-client/planner';

/**
 * План-графік — the production dispatcher center. A professional
 * hierarchical Gantt (components/domain/planner/planner-gantt.tsx) is the
 * primary view; this page owns the KPI bar, filters, problem dispatcher,
 * and print scaffolding around it. Photos are batch-fetched once here
 * (useFilesForEntities with every item's assemblyId in one call — same
 * "one request for the whole page" convention as sales/[id]'s
 * OrderPriceTotals) and handed down as a plain map, so the Gantt itself
 * never triggers its own per-row photo request.
 */

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

/** Primary click scrolls/highlights the row inside the Gantt (never navigates away); the small external-link icon is the explicit "go to the real entity" action — matches §11/§12 of the confirmed spec: jump-in-place is the default, navigation is a deliberate second action. */
function ProblemsPanel({ problems, onJump }: { problems: PlannerProblem[]; onJump: (p: PlannerProblem) => void }) {
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
          <ul className="space-y-1">
            {sorted.map((p, i) => {
              const Icon = SEVERITY_ICON[p.severity];
              return (
                <li key={`${p.code}-${p.entityId}-${i}`} className="flex items-start gap-2 rounded-md p-1.5 text-sm hover:bg-secondary">
                  <button type="button" onClick={() => onJump(p)} className="flex flex-1 items-start gap-2 text-left">
                    <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', SEVERITY_COLOR[p.severity])} />
                    <span>{p.message}</span>
                  </button>
                  <Link href={entityHref(p)} className="shrink-0 text-muted-foreground hover:text-primary" title={t('openEntity')}>
                    <ExternalLink className="h-3.5 w-3.5" />
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

export default function PlannerPage() {
  const t = useTranslations('planner');
  const ts = useTranslations('sales');

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [problemOnly, setProblemOnly] = useState(false);
  const [supplierId, setSupplierId] = useState<string | undefined>(undefined);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [pageSize, setPageSize] = useState<'A4' | 'A3'>('A4');
  const [year, setYear] = useState(new Date().getFullYear());
  const [view, setView] = useState<'gantt' | 'resources' | 'orders'>('gantt');
  const [printMode, setPrintMode] = useState<'current' | 'year'>('current');

  // Print range for the "По замовленнях" tab specifically (2026-08-27 user
  // request — "друкувати не тільки на рік а й на тиждень декілька тижнів
  // місяць декілька місяців"): independent of printMode above (that stays
  // for the Gantt/Resources tabs), because "По замовленнях" needs a
  // period the user can dial in freely rather than just current-filter vs
  // whole-year. `ordersPrintCount` multiplies the chosen scale's single
  // period (only meaningful for week/month) so "3 тижні"/"2 місяці" are one
  // stepper click away instead of needing a full custom-range picker.
  // Defaults deliberately mirror PlannerOrdersTimelineView's own screen
  // defaults (week scale, dates collapsed) — 2026-08-28 user request: print
  // should look like the on-screen graph the user is actually looking at,
  // not some different starting point.
  const [ordersPrintScale, setOrdersPrintScale] = useState<'week' | 'month' | 'year'>('week');
  const [ordersPrintAnchor, setOrdersPrintAnchor] = useState(() => new Date());
  const [ordersPrintCount, setOrdersPrintCount] = useState(1);
  // Same "менше — зручніше" idea as the on-screen collapse toggle: the 5
  // date fields are useful but take real width away from the timeline on
  // paper too, and unlike the screen there's no way to expand them back
  // mid-page — so this is a plain show/hide, decided once before printing.
  const [ordersPrintDatesHidden, setOrdersPrintDatesHidden] = useState(true);

  const query: QueryPlannerBoardInput = {
    search: search || undefined,
    status,
    problem: problemOnly ? 'true' : undefined,
    supplierId,
    from: dateFrom ? new Date(dateFrom).toISOString() : undefined,
    to: dateTo ? new Date(dateTo).toISOString() : undefined,
  };

  const { data: board, isLoading } = usePlannerBoard(query);
  const { data: kpis } = usePlannerKpis(query);
  const { data: suppliers } = useSuppliers({ limit: 200 });
  const { data: stages } = useProductionStages();

  const allAssemblyIds = useMemo(() => Array.from(new Set((board?.orders ?? []).flatMap((o) => o.items.map((i) => i.assemblyId)))), [board]);
  const { data: photosByAssembly } = useFilesForEntities('Assembly', allAssemblyIds, 'ASSEMBLY_PHOTO');
  const photoByAssembly = useMemo(() => {
    const map: Record<string, string | undefined> = {};
    for (const [assemblyId, files] of Object.entries(photosByAssembly ?? {})) {
      map[assemblyId] = files[0]?.downloadUrl;
    }
    return map;
  }, [photosByAssembly]);

  const ganttRef = useRef<PlannerGanttHandle>(null);
  function handleJumpToProblem(p: PlannerProblem) {
    ganttRef.current?.revealEntity(p.entityType, p.entityId, p.orderId);
  }

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

  const printFrom = printMode === 'year' ? new Date(year, 0, 1) : board ? new Date(board.from) : new Date();
  const printTo = printMode === 'year' ? new Date(year, 11, 31, 23, 59, 59) : board ? new Date(board.to) : new Date();
  // In 'year' mode printFrom/printTo are built directly in the browser's own
  // local time (new Date(year, 0, 1)) — formatting those locally is already
  // correct. In 'current' mode they come from board.from/board.to, whole-
  // calendar-day boundaries computed server-side and serialized as a UTC
  // instant; formatting THOSE in the viewer's local timezone (anything ahead
  // of UTC, e.g. Ukraine) can silently roll the displayed date into the next
  // day, so that path is pinned to UTC to read back the calendar day the
  // server actually meant. printFrom/printTo themselves stay real Date
  // instants for the print table's position math either way — only this
  // label's formatting differs.
  const periodLabel =
    printMode === 'year'
      ? `${printFrom.toLocaleDateString('uk-UA')} — ${printTo.toLocaleDateString('uk-UA')}`
      : `${printFrom.toLocaleDateString('uk-UA', { timeZone: 'UTC' })} — ${printTo.toLocaleDateString('uk-UA', { timeZone: 'UTC' })}`;

  /** Sets the print range before invoking window.print() — needs one tick for React to re-render the print table with the new from/to first. */
  function handlePrint(mode: 'current' | 'year') {
    setPrintMode(mode);
    window.setTimeout(() => window.print(), 50);
  }

  const ordersPrintFrom =
    ordersPrintScale === 'year' ? new Date(year, 0, 1) : ordersPrintScale === 'month' ? startOfMonth(ordersPrintAnchor) : startOfWeek(ordersPrintAnchor);
  const ordersPrintTo =
    ordersPrintScale === 'year'
      ? new Date(year, 11, 31, 23, 59, 59)
      : ordersPrintScale === 'month'
        ? new Date(ordersPrintFrom.getFullYear(), ordersPrintFrom.getMonth() + ordersPrintCount, 0, 23, 59, 59)
        : new Date(ordersPrintFrom.getTime() + ordersPrintCount * 7 * 86400000 - 1000);
  const ordersPeriodLabel = `${ordersPrintFrom.toLocaleDateString('uk-UA')} — ${ordersPrintTo.toLocaleDateString('uk-UA')}`;

  function panOrdersPrint(dir: 1 | -1) {
    if (ordersPrintScale === 'year') {
      setYear(year + dir);
    } else if (ordersPrintScale === 'week') {
      setOrdersPrintAnchor(new Date(ordersPrintAnchor.getTime() + dir * ordersPrintCount * 7 * 86400000));
    } else {
      setOrdersPrintAnchor(new Date(ordersPrintAnchor.getFullYear(), ordersPrintAnchor.getMonth() + dir * ordersPrintCount, 1));
    }
  }

  function handlePrintOrders() {
    window.setTimeout(() => window.print(), 50);
  }

  return (
    <div className="space-y-4">
      <style>{`
        @page { size: ${pageSize} landscape; margin: 10mm; }
        /* Best-effort — Chromium-based print-to-PDF honors @page margin-box page counters; not universally supported across every browser, disclosed rather than assumed. */
        @page { @bottom-center { content: "${t('pageLabel')} " counter(page) " / " counter(pages); font-size: 8px; } }
      `}</style>

      <div className="flex flex-wrap items-start justify-between gap-3 no-print">
        <div>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LearnThisButton courseId="planner" label="Навчитися працювати з План-графіком" />
          <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
            <button
              type="button"
              onClick={() => setView('gantt')}
              className={cn('rounded px-2 py-1 text-xs font-medium', view === 'gantt' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary')}
            >
              {t('ganttTab')}
            </button>
            <button
              type="button"
              onClick={() => setView('resources')}
              className={cn('rounded px-2 py-1 text-xs font-medium', view === 'resources' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary')}
            >
              {t('resourcesTab')}
            </button>
            <button
              type="button"
              onClick={() => setView('orders')}
              className={cn('rounded px-2 py-1 text-xs font-medium', view === 'orders' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary')}
            >
              {t('ordersTab')}
            </button>
          </div>
          <Select value={pageSize} onValueChange={(v) => setPageSize(v as 'A4' | 'A3')}>
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="A4">A4</SelectItem>
              <SelectItem value="A3">A3</SelectItem>
            </SelectContent>
          </Select>
          {view === 'orders' ? (
            <>
              <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
                {(['week', 'month', 'year'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setOrdersPrintScale(s)}
                    className={cn('rounded px-2 py-1 text-xs font-medium', ordersPrintScale === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary')}
                  >
                    {t(`scale${s[0].toUpperCase()}${s.slice(1)}`)}
                  </button>
                ))}
              </div>
              {ordersPrintScale !== 'year' && (
                <div className="flex items-center gap-1 rounded-md border border-border p-0.5" title={t('printRangeCount')}>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setOrdersPrintCount((c) => Math.max(1, c - 1))}>
                    <Minus className="h-3 w-3" />
                  </Button>
                  <span className="min-w-[1.2rem] text-center text-xs font-medium">{ordersPrintCount}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setOrdersPrintCount((c) => Math.min(12, c + 1))}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              )}
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => panOrdersPrint(-1)} title={t('prevPeriod')}>
                  <ChevronRight className="h-4 w-4 rotate-180" />
                </Button>
                <span className="min-w-[9rem] text-center text-xs">{ordersPeriodLabel}</span>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => panOrdersPrint(1)} title={t('nextPeriod')}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <Button
                type="button"
                variant={ordersPrintDatesHidden ? 'default' : 'outline'}
                size="sm"
                onClick={() => setOrdersPrintDatesHidden((v) => !v)}
                title={t('printHideDates')}
              >
                <ColumnsIcon className="mr-2 h-4 w-4" />
                {t('printHideDates')}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={handlePrintOrders}>
                <Printer className="mr-2 h-4 w-4" />
                {t('printButton')}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => handlePrint('current')}>
                <Printer className="mr-2 h-4 w-4" />
                {t('printButton')}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => handlePrint('year')}>
                <Printer className="mr-2 h-4 w-4" />
                {t('printYearButton')}
              </Button>
            </>
          )}
          <PreviewButton />
        </div>
      </div>

      <div data-tour="planner-kpi-bar" className="no-print grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
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

      <Card className="no-print">
        <CardContent className="flex flex-wrap items-center gap-3 py-4">
          <div className="relative w-56">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder={t('filterSearch')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={status ?? '__all__'} onValueChange={(v) => setStatus(v === '__all__' ? undefined : v)}>
            <SelectTrigger className="w-44">
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
          <Select value={supplierId ?? '__all__'} onValueChange={(v) => setSupplierId(v === '__all__' ? undefined : v)}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder={t('filterSupplier')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t('filterSupplier')}</SelectItem>
              {(suppliers?.items ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1.5">
            <Input type="date" className="w-36" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title={t('filterFrom')} />
            <span className="text-muted-foreground">—</span>
            <Input type="date" className="w-36" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title={t('filterTo')} />
          </div>
          <Button variant={problemOnly ? 'default' : 'outline'} size="sm" onClick={() => setProblemOnly((v) => !v)}>
            {t('filterOnlyProblems')}
          </Button>
        </CardContent>
      </Card>

      <div className="no-print" data-tour="planner-problems-panel">{board && <ProblemsPanel problems={board.problems} onJump={handleJumpToProblem} />}</div>

      {isLoading || !board ? (
        <LoadingBlock />
      ) : board.orders.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground no-print">{t('noOrders')}</p>
      ) : (
        <>
          {view !== 'orders' && (
            <div className="no-print flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm border border-foreground/40 opacity-60" />{t('planLabel')}</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-sm bg-foreground/70" />{t('factLabel')}</span>
            </div>
          )}
          <div className="no-print" data-tour="planner-board">
            {view === 'gantt' ? (
              <PlannerGanttChart ref={ganttRef} orders={board.orders} stages={stages ?? []} photoByAssembly={photoByAssembly} year={year} onYearChange={setYear} />
            ) : view === 'resources' ? (
              <PlannerResourcesView orders={board.orders} problems={board.problems} year={year} />
            ) : (
              <PlannerOrdersTimelineView orders={board.orders} year={year} onYearChange={setYear} />
            )}
          </div>

          <PrintArea>
            <PrintDocumentHeader
              title={view === 'orders' ? t('printTitle') : printMode === 'year' ? `${t('printYearTitle')} ${year}` : t('printTitle')}
              subtitle={t('printSubtitle')}
            />
            <p className="mb-3 text-xs">
              {t('printPeriod')}: {view === 'orders' ? ordersPeriodLabel : periodLabel}
            </p>
            {view === 'orders' ? (
              <>
                <PlannerOrdersPrintTable
                  orders={board.orders}
                  from={ordersPrintFrom}
                  to={ordersPrintTo}
                  scale={ordersPrintScale}
                  datesHidden={ordersPrintDatesHidden}
                />
                <div className="mt-4">
                  <strong className="text-[9px]">{t('legendTitle')}:</strong>
                  <div className="mt-1">
                    <PlannerOrdersPrintLegend />
                  </div>
                </div>
              </>
            ) : (
              <>
                <PlannerGanttPrintTable orders={board.orders} photoByAssembly={photoByAssembly} from={printFrom} to={printTo} />
                <div className="mt-4 text-[9px]">
                  <strong>{t('legendTitle')}:</strong> {t('legendPlan')} · {t('legendFact')} · {t('legendMilestone')} · {t('legendWarning')} · {t('legendCritical')}
                </div>
              </>
            )}
          </PrintArea>
        </>
      )}
    </div>
  );
}
