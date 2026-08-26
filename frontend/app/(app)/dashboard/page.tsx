'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Package, Layers, AlertTriangle, PackageCheck, Factory, ShoppingCart, Truck, Users, ChevronLeft, ChevronRight, Send, CalendarRange } from 'lucide-react';
import { useSessionStore } from '@/lib/auth/session-store';
import { useDashboardSummary, useOperationsTimeline } from '@/lib/hooks/use-dashboard';
import { usePlannerBoard } from '@/lib/hooks/use-planner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingBlock } from '@/components/ui/loading-block';
import { cn } from '@/lib/utils';
import { PrintArea, PrintDocumentHeader, PrintButton, PreviewButton } from '@/components/domain/print/print-area';
import { OperationsTimelineSection, OperationsTimelineLegend } from '@/components/domain/dashboard/operations-timeline';
import { PlannerOrdersTimelineView } from '@/components/domain/planner/planner-orders-timeline';
import { PlannerOrdersPrintTable } from '@/components/domain/planner/planner-orders-print';
import type { TimelineStage } from '@/lib/api-client/dashboard';

/**
 * Real landing page, backed by GET /dashboard/summary (backend/src/modules/
 * dashboard/) — replaces the earlier deliberate placeholder (every card
 * used to show "—"; see git history on this file) now that Reports/
 * production/sales/procurement all have real data to pull from. Every card
 * links straight to the module it summarizes, so a glance-then-click flow
 * works for every role, not just admins.
 *
 * Below the KPI cards: the unified operations timeline (GET /dashboard/
 * operations-timeline) — purchase orders, production, and shipments drawn
 * on one shared Gantt so the whole pipeline's state is visible at a
 * glance, printable via the same PrintArea convention every other document
 * in this app uses (components/domain/dashboard/operations-timeline.tsx
 * has the chart itself).
 */
export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const tn = useTranslations('nav');
  const tp = useTranslations('print');
  const tPlanner = useTranslations('planner');
  const router = useRouter();
  const companySlug = useSessionStore((s) => s.companySlug);
  const { data, isLoading, isError } = useDashboardSummary();

  const [year, setYear] = useState(new Date().getFullYear());
  const from = useMemo(() => new Date(year, 0, 1), [year]);
  const to = useMemo(() => new Date(year, 11, 31, 23, 59, 59), [year]);
  const { data: timeline, isLoading: timelineLoading } = useOperationsTimeline({ from: from.toISOString(), to: to.toISOString() });
  // "По замовленнях" (2026-08-28 user request — same board data/component
  // the Planner page's own tab uses, just dropped onto the dashboard ahead
  // of the purchase-orders timeline so a per-order schedule is visible
  // without leaving the landing page).
  const { data: board } = usePlannerBoard({ from: from.toISOString(), to: to.toISOString() });

  const stageLabels: Record<TimelineStage, string> = {
    planned: t('stagePlanned'),
    in_progress: t('stageInProgress'),
    completed: t('stageCompleted'),
  };

  const cards: {
    key: string;
    navKey: string;
    href: string;
    icon: typeof Package;
    label: string;
    value: number | undefined;
    warn: boolean;
  }[] = [
    { key: 'products', navKey: 'catalog', href: '/catalog', icon: Package, label: t('productsTotal'), value: data?.productsCount, warn: false },
    {
      // Icon (not just color) reflects the actual state — a triangle-with-!
      // inside an otherwise-neutral gray box read as "something's wrong"
      // even when lowStockCount was 0 and every other style already said
      // "fine" (no red border/background/text, per `warn` below).
      key: 'lowStock',
      navKey: 'inventory',
      href: '/inventory',
      icon: (data?.lowStockCount ?? 0) > 0 ? AlertTriangle : PackageCheck,
      label: (data?.lowStockCount ?? 0) > 0 ? t('lowStock') : t('lowStockOk'),
      value: data?.lowStockCount,
      warn: (data?.lowStockCount ?? 0) > 0,
    },
    { key: 'assemblies', navKey: 'bom', href: '/bom', icon: Layers, label: t('assembliesTotal'), value: data?.assembliesCount, warn: false },
    { key: 'production', navKey: 'production', href: '/production', icon: Factory, label: t('activeProductionOrders'), value: data?.activeProductionOrders, warn: false },
    { key: 'procurement', navKey: 'procurement', href: '/procurement', icon: Truck, label: t('openPurchaseOrders'), value: data?.openPurchaseOrders, warn: false },
    { key: 'sales', navKey: 'sales', href: '/sales', icon: ShoppingCart, label: t('pendingCustomerOrders'), value: data?.pendingCustomerOrders, warn: false },
    { key: 'hr', navKey: 'hr', href: '/hr', icon: Users, label: t('activeEmployees'), value: data?.activeEmployees, warn: false },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">
          {t('welcome')}
          {companySlug ? `, ${companySlug}` : ''}
        </h1>
        <p className="text-sm text-muted-foreground">{t('overview')}</p>
      </div>

      {isError && <p className="text-sm text-destructive">{t('loadFailed')}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ key, navKey, href, icon: Icon, label, value, warn }) => (
          <Link key={key} href={href}>
            <Card className={cn('transition-colors hover:border-primary/50', warn && 'border-destructive/50 bg-destructive/5')}>
              <CardHeader className="flex-row items-center gap-3 space-y-0">
                <span
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground',
                    warn && 'bg-destructive/15 text-destructive',
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <CardTitle className="text-base">{tn(navKey)}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={cn('text-2xl font-semibold', warn && 'text-destructive')}>
                  {isLoading ? '—' : (value ?? 0)}
                </p>
                <p className="text-sm text-muted-foreground">{label}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="no-print space-y-4">
        <Card>
          <CardContent className="flex flex-row flex-wrap items-center justify-between gap-3 py-4">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={() => setYear((y) => y - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="w-16 text-center text-base font-semibold">{year}</span>
              <Button variant="outline" size="icon" onClick={() => setYear((y) => y + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <span className="ml-2 text-base font-semibold">{t('timelineTitle')}</span>
            </div>
            <div className="flex items-center gap-4">
              <OperationsTimelineLegend labels={stageLabels} />
              <PrintButton label={tp('printAction')} />
              <PreviewButton />
            </div>
          </CardContent>
        </Card>

        {board && board.orders.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="flex items-center gap-2.5 border-b border-border bg-muted/40 px-3 py-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                <CalendarRange className="h-4 w-4" />
              </span>
              <h3 className="text-sm font-semibold">{tPlanner('ordersTab')}</h3>
              <Badge variant="outline" className="ml-auto">
                {board.orders.length}
              </Badge>
            </div>
            <div className="p-3">
              <PlannerOrdersTimelineView orders={board.orders} year={year} onYearChange={setYear} />
            </div>
          </div>
        )}

        {timelineLoading || !timeline ? (
          <Card>
            <CardContent className="py-6">
              <LoadingBlock />
            </CardContent>
          </Card>
        ) : (
          <>
            <OperationsTimelineSection
              title={t('timelinePurchaseOrders')}
              icon={Truck}
              lines={timeline.purchaseOrders}
              from={from}
              to={to}
              emptyLabel={t('timelineEmpty')}
              todayLabel={t('today')}
              showMonthHeader
              onItemClick={(id) => router.push(`/procurement/${id}`)}
            />
            <OperationsTimelineSection
              title={t('timelineProduction')}
              icon={Factory}
              lines={timeline.productionOrders}
              from={from}
              to={to}
              emptyLabel={t('timelineEmpty')}
              todayLabel={t('today')}
              onItemClick={(id) => router.push(`/production/${id}`)}
            />
            <OperationsTimelineSection
              title={t('timelineShipments')}
              icon={Send}
              lines={timeline.shipments}
              from={from}
              to={to}
              emptyLabel={t('timelineEmpty')}
              todayLabel={t('today')}
              onItemClick={(id) => router.push(`/sales/shipments/${id}`)}
            />
          </>
        )}
      </div>

      {timeline && (
        <PrintArea>
          <PrintDocumentHeader title={t('timelinePrintTitle')} subtitle={String(year)} />
          <div className="mb-4">
            <OperationsTimelineLegend labels={stageLabels} />
          </div>
          {board && board.orders.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 text-sm font-semibold">{tPlanner('ordersTab')}</h3>
              <PlannerOrdersPrintTable orders={board.orders} from={from} to={to} scale="year" datesHidden />
            </div>
          )}
          <div className="space-y-4">
            <OperationsTimelineSection
              title={t('timelinePurchaseOrders')}
              icon={Truck}
              lines={timeline.purchaseOrders}
              from={from}
              to={to}
              emptyLabel={t('timelineEmpty')}
              todayLabel={t('today')}
              showMonthHeader
              onItemClick={() => {}}
            />
            <OperationsTimelineSection
              title={t('timelineProduction')}
              icon={Factory}
              lines={timeline.productionOrders}
              from={from}
              to={to}
              emptyLabel={t('timelineEmpty')}
              todayLabel={t('today')}
              onItemClick={() => {}}
            />
            <OperationsTimelineSection
              title={t('timelineShipments')}
              icon={Send}
              lines={timeline.shipments}
              from={from}
              to={to}
              emptyLabel={t('timelineEmpty')}
              todayLabel={t('today')}
              onItemClick={() => {}}
            />
          </div>
        </PrintArea>
      )}
    </div>
  );
}
