'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCustomerOrder, useOrderProductionUnits } from '@/lib/hooks/use-sales';
import { LoadingBlock } from '@/components/ui/loading-block';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AssemblyCell } from '@/components/domain/sales/assembly-cell';
import { ProductionProgressTree } from '@/components/domain/sales/production-progress-tree';
import { ProductionProgressPrint } from '@/components/domain/sales/production-progress-print';
import { FinanceSummaryWidget } from '@/components/domain/sales/finance-summary-widget';
import { PayrollFundWidget } from '@/components/domain/sales/payroll-fund-widget';
import { OrderPayrollByEmployee } from '@/components/domain/sales/order-payroll-by-employee';
import { OrderProductionUnitsTable } from '@/components/domain/production/order-production-units-table';
import type { CustomerOrderStatus } from '@/lib/api-client/sales';

const STATUS_VARIANT: Record<CustomerOrderStatus, 'secondary' | 'warning' | 'success' | 'destructive'> = {
  NEW: 'secondary',
  IN_PRODUCTION: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'destructive',
};

/**
 * Order detail: the full BOM production tree ("Хід виробництва", same
 * ProductionProgressTree the Sales order page shows collapsed), "В роботі"
 * (manufactured, not yet confirmed by a worker) / "Що зроблено" (purchased
 * outright or manufactured-and-confirmed, both via getOrderProductionUnits),
 * "Фінанси"/"Зарплата" (the same widgets the Sales order page shows), and
 * "По працівниках" — who earned how much and made how many of what, via
 * getOrderPayrollByEmployee. Shared (2026-08-30) between "План виробництва"
 * and Виробництво → "По замовленнях" — same detail page reachable from
 * either entry point.
 */
export function ProductionPlanOrderDetail({ orderId }: { orderId: string }) {
  const t = useTranslations('sales');
  const tp = useTranslations('production');
  const tFin = useTranslations('finance');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { data: order, isLoading } = useCustomerOrder(orderId);
  const { data: units, isLoading: unitsLoading } = useOrderProductionUnits(orderId);

  if (isLoading || !order) {
    return <LoadingBlock />;
  }

  // Tab state kept in the URL (2026-08-31 fix — "не друкує нічого не
  // відображається"): PreviewButton opens `?print=1` in a FRESH tab, which
  // re-mounts this whole page from scratch — an uncontrolled Tabs
  // (defaultValue only) always re-lands on "progress" there regardless of
  // which tab was actually open when Print/Preview was clicked, so any
  // print area on a non-default tab (like Фонд's "Оцінка по виробах") was
  // never even in the DOM to portal into. Controlled + synced to `?tab=`
  // means the preview tab's URL (copied verbatim from window.location.href)
  // reopens on the SAME tab.
  const activeTab = searchParams.get('tab') ?? 'progress';
  function handleTabChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', value);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">{order.clientName}</h2>
          {order.orderNumber && <span className="text-sm text-muted-foreground">{order.orderNumber}</span>}
          <Badge variant={STATUS_VARIANT[order.status]}>{t(`orderStatus${order.status}`)}</Badge>
        </div>
        <Link href={`/sales/${order.id}`} className="text-sm text-primary hover:underline">
          {tp('viewInSales')}
        </Link>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="progress">{t('productionProgress')}</TabsTrigger>
          <TabsTrigger value="in-progress">{tp('inProgressTab')}</TabsTrigger>
          <TabsTrigger value="ready">{tp('readyTab')}</TabsTrigger>
          <TabsTrigger value="finance">{tFin('financeSummary')}</TabsTrigger>
          <TabsTrigger value="payroll">{tp('payrollTab')}</TabsTrigger>
          <TabsTrigger value="payroll-by-employee">{tp('payrollByEmployeeTab')}</TabsTrigger>
        </TabsList>

        <TabsContent value="progress">
          <Card>
            <CardHeader className="flex flex-col gap-2 space-y-0 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base">{t('productionProgress')}</CardTitle>
              <ProductionProgressPrint order={order} />
            </CardHeader>
            <CardContent className="space-y-6">
              {(order.items ?? []).map((item) => (
                <div key={item.id} className="space-y-2">
                  <div className="rounded-md border-2 border-primary/40 bg-primary/5 p-3">
                    <AssemblyCell assemblyId={item.assemblyId} size="lg" textClassName="text-base font-semibold" />
                  </div>
                  <ProductionProgressTree orderId={order.id} itemId={item.id} />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="in-progress">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{tp('inProgressTab')}</CardTitle>
            </CardHeader>
            <CardContent>
              <OrderProductionUnitsTable lines={units?.inProgress ?? []} isLoading={unitsLoading} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ready">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{tp('readyTab')}</CardTitle>
            </CardHeader>
            <CardContent>
              <OrderProductionUnitsTable lines={units?.ready ?? []} isLoading={unitsLoading} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="finance">
          <FinanceSummaryWidget customerOrderId={order.id} />
        </TabsContent>

        <TabsContent value="payroll">
          <PayrollFundWidget orderId={order.id} defaultOpen orderLabel={`${order.clientName}${order.orderNumber ? ` — № ${order.orderNumber}` : ''}`} />
        </TabsContent>

        <TabsContent value="payroll-by-employee">
          <OrderPayrollByEmployee orderId={order.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
