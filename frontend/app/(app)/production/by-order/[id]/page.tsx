'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCustomerOrder } from '@/lib/hooks/use-sales';
import { LoadingBlock } from '@/components/ui/loading-block';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AssemblyCell } from '@/components/domain/sales/assembly-cell';
import { ProductionProgressTree } from '@/components/domain/sales/production-progress-tree';
import { ProductionProgressPrint } from '@/components/domain/sales/production-progress-print';
import type { CustomerOrderStatus } from '@/lib/api-client/sales';

const STATUS_VARIANT: Record<CustomerOrderStatus, 'secondary' | 'warning' | 'success' | 'destructive'> = {
  NEW: 'secondary',
  IN_PRODUCTION: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'destructive',
};

/**
 * Full production tree for every item on this order (2026-08-27 user
 * request) — the same ProductionProgressTree already shown (collapsed by
 * default) on the Sales order page, surfaced here directly and expanded,
 * reachable from Production's "По замовленнях" tab for staff who live in
 * Production rather than Sales.
 */
export default function ProductionByOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const t = useTranslations('sales');
  const tp = useTranslations('production');

  const { data: order, isLoading } = useCustomerOrder(params.id);

  if (isLoading || !order) {
    return <LoadingBlock />;
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
    </div>
  );
}
