'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useFinancePurchaseOrders } from '@/lib/hooks/use-finance';
import { formatMoney } from '@/lib/finance-format';
import type { FinancePaymentStatus } from '@/lib/api-client/finance';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { LoadingBlock } from '@/components/ui/loading-block';

const PAGE_SIZE = 30;

const STATUS_VARIANT: Record<FinancePaymentStatus, 'secondary' | 'warning' | 'success'> = {
  UNPAID: 'secondary',
  PARTIAL: 'warning',
  PAID: 'success',
};

/**
 * `/finance` — the list of Purchase Orders, each with its own six-metric
 * summary card. Deliberately NOT a global document list (confirmed UX
 * decision, chat 2026-08-24): clicking a card is the only way in, landing
 * on that PO's own /finance/[purchaseOrderId] page.
 */
export default function FinancePage() {
  const t = useTranslations('finance');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<FinancePaymentStatus | undefined>(undefined);
  const [offset, setOffset] = useState(0);

  // Small inline debounce — this app has no shared useDebounce hook yet,
  // and one input on one page doesn't warrant adding one.
  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(searchInput);
      setOffset(0);
    }, 250);
    return () => clearTimeout(id);
  }, [searchInput]);

  const { data, isLoading } = useFinancePurchaseOrders({ search: search || undefined, paymentStatus, limit: PAGE_SIZE, offset });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            className="w-64"
            placeholder={t('searchPlaceholder')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <Select
            value={paymentStatus ?? '__all'}
            onValueChange={(v) => { setPaymentStatus(v === '__all' ? undefined : (v as FinancePaymentStatus)); setOffset(0); }}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder={t('filterByPaymentStatus')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">{t('allStatuses')}</SelectItem>
              <SelectItem value="UNPAID">{t('paymentStatusUNPAID')}</SelectItem>
              <SelectItem value="PARTIAL">{t('paymentStatusPARTIAL')}</SelectItem>
              <SelectItem value="PAID">{t('paymentStatusPAID')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading && <LoadingBlock />}

      {!isLoading && (data?.items.length ?? 0) === 0 && (
        <p className="text-sm text-muted-foreground">{t('noPurchaseOrders')}</p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data?.items.map((row) => (
          <Link key={row.purchaseOrder.id} href={`/finance/${row.purchaseOrder.id}`}>
            <Card className="h-full transition-colors hover:border-primary/50">
              <CardContent className="space-y-2 pt-6">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{row.purchaseOrder.supplierNameSnapshot}</div>
                    <div className="text-xs text-muted-foreground">{new Date(row.purchaseOrder.orderDate).toLocaleDateString()}</div>
                  </div>
                  <Badge variant={STATUS_VARIANT[row.paymentStatus]}>{t(`paymentStatus${row.paymentStatus}`)}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 pt-1 text-sm">
                  <span className="text-muted-foreground">{t('actualCost')}</span>
                  <span className="text-right font-medium">{formatMoney(row.summary.actualCost, row.summary.primaryCurrency)}</span>
                  <span className="text-muted-foreground">{t('paid')}</span>
                  <span className="text-right">{formatMoney(row.summary.paid, row.summary.primaryCurrency)}</span>
                  <span className="text-muted-foreground">{t('unpaidPerDocuments')}</span>
                  <span className="text-right">{formatMoney(row.summary.unpaidPerDocuments, row.summary.primaryCurrency)}</span>
                  <span className="text-muted-foreground">{t('documentCount')}</span>
                  <span className="text-right">{row.summary.documentCount}</span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {data && data.total > PAGE_SIZE && (
        <div className="flex justify-center gap-2 pt-2 text-sm">
          <button
            type="button"
            disabled={offset === 0}
            className="disabled:opacity-40"
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            ←
          </button>
          <span className="text-muted-foreground">{offset + 1}–{Math.min(offset + PAGE_SIZE, data.total)} / {data.total}</span>
          <button
            type="button"
            disabled={offset + PAGE_SIZE >= data.total}
            className="disabled:opacity-40"
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}
