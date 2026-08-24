'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { useCustomerOrderFinanceSummary } from '@/lib/hooks/use-finance';
import { useCustomerOrder } from '@/lib/hooks/use-sales';
import { useDeletePurchaseOrder } from '@/lib/hooks/use-procurement';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { formatMoney } from '@/lib/finance-format';
import { useHasPermission } from '@/lib/hooks/use-roles';
import type { FinancePaymentStatus } from '@/lib/api-client/finance';
import { DocumentsPanel } from '@/components/domain/finance/documents-panel';
import { ExpensesPanel } from '@/components/domain/finance/expenses-panel';
import { CustomerOrderFinancePrint } from '@/components/domain/finance/customer-order-finance-print';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingBlock } from '@/components/ui/loading-block';

const PO_STATUS_VARIANT: Record<FinancePaymentStatus, 'secondary' | 'warning' | 'success'> = {
  UNPAID: 'secondary',
  PARTIAL: 'warning',
  PAID: 'success',
};

/**
 * CustomerOrder-Finance (2026-08-24 pivot). Cost = automatic rollup of
 * every linked PurchaseOrder's own Finance data (see the "Закупівлі"
 * section below — reused as-is, no duplication) + direct documents/
 * expenses recorded here on the order itself.
 */
function SummaryCard({ customerOrderId }: { customerOrderId: string }) {
  const t = useTranslations('finance');
  const { data: summary } = useCustomerOrderFinanceSummary(customerOrderId);
  if (!summary) return null;

  const rows: [string, number][] = [
    [t('purchaseCost'), summary.purchaseCost],
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

/** One linked-PurchaseOrder card: navigates to its own Finance page (reused, not duplicated), plus an admin-only delete action and an inline expand showing its documents/expenses without leaving this page. */
function LinkedPurchaseOrderCard({
  customerOrderId,
  purchaseOrder,
  summary,
  canManageFinance,
}: {
  customerOrderId: string;
  purchaseOrder: { id: string; supplierNameSnapshot: string; orderDate: string };
  summary: { actualCost: number; primaryCurrency: string; paid: number; totalDocuments: number };
  canManageFinance: boolean;
}) {
  const t = useTranslations('finance');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const apiErrorMessage = useApiErrorMessage();
  const canDelete = useHasPermission('purchase-orders:delete');
  const deleteOrder = useDeletePurchaseOrder();
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status: FinancePaymentStatus = summary.paid >= summary.totalDocuments && summary.totalDocuments > 0 ? 'PAID' : summary.paid > 0 ? 'PARTIAL' : 'UNPAID';

  async function handleDelete() {
    setError(null);
    if (!window.confirm(t('confirmDelete'))) return;
    try {
      await deleteOrder.mutateAsync(purchaseOrder.id);
      qc.invalidateQueries({ queryKey: ['finance', 'customer-order-summary', customerOrderId] });
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between gap-2 p-3 text-sm">
        <Link href={`/finance/purchase-orders/${purchaseOrder.id}`} className="flex-1 transition-colors hover:text-primary">
          <div className="font-medium">{purchaseOrder.supplierNameSnapshot}</div>
          <div className="text-xs text-muted-foreground">{new Date(purchaseOrder.orderDate).toLocaleDateString()}</div>
        </Link>
        <div className="flex items-center gap-2">
          <span>{formatMoney(summary.actualCost, summary.primaryCurrency)}</span>
          <Badge variant={PO_STATUS_VARIANT[status]}>{t(`paymentStatus${status}`)}</Badge>
          <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setExpanded((v) => !v)}>
            {expanded ? t('collapse') : t('expand')}
          </button>
          {canDelete && (
            <button type="button" className="text-xs text-destructive hover:underline" onClick={handleDelete} disabled={deleteOrder.isPending}>
              {tc('delete')}
            </button>
          )}
        </div>
      </div>
      {error && <p className="px-3 pb-2 text-sm text-destructive">{error}</p>}
      {expanded && (
        <div className="space-y-3 border-t p-3">
          <DocumentsPanel kind="purchase-order" ownerId={purchaseOrder.id} canManage={canManageFinance} />
          <ExpensesPanel kind="purchase-order" ownerId={purchaseOrder.id} canManage={canManageFinance} />
        </div>
      )}
    </div>
  );
}

/** Rollup section — every linked PurchaseOrder, each with its own already-built Finance summary. */
function LinkedPurchaseOrdersPanel({ customerOrderId, canManageFinance }: { customerOrderId: string; canManageFinance: boolean }) {
  const t = useTranslations('finance');
  const { data: summary } = useCustomerOrderFinanceSummary(customerOrderId);
  const purchaseOrders = summary?.purchaseOrders ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('linkedPurchaseOrders')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {purchaseOrders.length === 0 && <p className="text-sm text-muted-foreground">{t('noLinkedPurchaseOrders')}</p>}
        {purchaseOrders.map((p) => (
          <LinkedPurchaseOrderCard
            key={p.purchaseOrder.id}
            customerOrderId={customerOrderId}
            purchaseOrder={p.purchaseOrder}
            summary={p.summary}
            canManageFinance={canManageFinance}
          />
        ))}
      </CardContent>
    </Card>
  );
}

export default function CustomerOrderFinancePage() {
  const params = useParams<{ customerOrderId: string }>();
  const customerOrderId = params.customerOrderId;
  const t = useTranslations('finance');
  const { data: order, isLoading } = useCustomerOrder(customerOrderId);
  const canManage = useHasPermission('finance:manage');

  if (isLoading) return <LoadingBlock />;
  if (!order) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{order.orderNumber || order.clientName}</h1>
          <p className="text-sm text-muted-foreground">{order.clientName}</p>
        </div>
        <CustomerOrderFinancePrint customerOrderId={customerOrderId} orderLabel={`${order.clientName}${order.orderNumber ? ` — № ${order.orderNumber}` : ''}`} />
      </div>
      <SummaryCard customerOrderId={customerOrderId} />
      <LinkedPurchaseOrdersPanel customerOrderId={customerOrderId} canManageFinance={canManage} />
      <DocumentsPanel kind="customer-order" ownerId={customerOrderId} canManage={canManage} title={t('directDocuments')} />
      <ExpensesPanel kind="customer-order" ownerId={customerOrderId} canManage={canManage} title={t('directExpenses')} />
    </div>
  );
}
