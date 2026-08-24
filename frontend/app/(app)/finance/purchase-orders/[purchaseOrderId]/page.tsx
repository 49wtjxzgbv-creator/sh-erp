'use client';

import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useFinanceSummary } from '@/lib/hooks/use-finance';
import { usePurchaseOrder } from '@/lib/hooks/use-procurement';
import { formatMoney } from '@/lib/finance-format';
import { useHasPermission } from '@/lib/hooks/use-roles';
import { DocumentsPanel } from '@/components/domain/finance/documents-panel';
import { ExpensesPanel } from '@/components/domain/finance/expenses-panel';
import { Card, CardContent } from '@/components/ui/card';
import { LoadingBlock } from '@/components/ui/loading-block';

function SummaryCard({ purchaseOrderId }: { purchaseOrderId: string }) {
  const t = useTranslations('finance');
  const { data: summary } = useFinanceSummary(purchaseOrderId);
  if (!summary) return null;

  const rows: [string, number][] = [
    [t('goodsCost'), summary.goodsCost],
    [t('additionalExpenses'), summary.additionalExpenses],
    [t('actualCost'), summary.actualCost],
    [t('paid'), summary.paid],
    [t('unpaidPerDocuments'), summary.unpaidPerDocuments],
  ];

  return (
    <Card>
      <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 pt-6 sm:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label}>
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-lg font-semibold">{formatMoney(value, summary.primaryCurrency)}</div>
          </div>
        ))}
        <div>
          <div className="text-xs text-muted-foreground">{t('documentCount')}</div>
          <div className="text-lg font-semibold">{summary.documentCount}</div>
        </div>
        {summary.otherCurrencies.map((bucket) => (
          <div key={bucket.currency} className="col-span-2 rounded-md border border-dashed p-2 text-xs sm:col-span-3">
            <span className="font-medium">{bucket.currency}: </span>
            {t('additionalExpenses')} {formatMoney(bucket.additionalExpenses, bucket.currency)} ·{' '}
            {t('totalDocuments')} {formatMoney(bucket.totalDocuments, bucket.currency)} ·{' '}
            {t('paid')} {formatMoney(bucket.paid, bucket.currency)} ·{' '}
            {t('unpaidPerDocuments')} {formatMoney(bucket.unpaidPerDocuments, bucket.currency)}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function PurchaseOrderFinancePage() {
  const params = useParams<{ purchaseOrderId: string }>();
  const purchaseOrderId = params.purchaseOrderId;
  const { data: order, isLoading } = usePurchaseOrder(purchaseOrderId);
  const canManage = useHasPermission('finance:manage');

  if (isLoading) return <LoadingBlock />;
  if (!order) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{order.supplierNameSnapshot}</h1>
        <p className="text-sm text-muted-foreground">{new Date(order.orderDate).toLocaleDateString()}</p>
      </div>
      <SummaryCard purchaseOrderId={purchaseOrderId} />
      <DocumentsPanel kind="purchase-order" ownerId={purchaseOrderId} canManage={canManage} defaultSupplierId={order.supplierId ?? undefined} />
      <ExpensesPanel kind="purchase-order" ownerId={purchaseOrderId} canManage={canManage} />
    </div>
  );
}
