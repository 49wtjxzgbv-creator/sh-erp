'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCustomerOrderFinanceSummary } from '@/lib/hooks/use-finance';
import { formatMoney } from '@/lib/finance-format';
import { useHasPermission } from '@/lib/hooks/use-roles';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Finance module (2026-08-24 pivot) — compact summary only, deliberately
 * not the full Finance UI (same "don't duplicate" rule as the earlier
 * PurchaseOrder-side widget). Hidden entirely without `finance:read` (the
 * module defaults to admin-only). Extracted from sales/[id]/page.tsx
 * (2026-08-30) so План виробництва's order detail page can show it too.
 */
export function FinanceSummaryWidget({ customerOrderId }: { customerOrderId: string }) {
  const t = useTranslations('finance');
  const canReadFinance = useHasPermission('finance:read');
  const { data: summary } = useCustomerOrderFinanceSummary(canReadFinance ? customerOrderId : undefined);
  if (!canReadFinance || !summary) return null;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 space-y-0 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-base">{t('financeSummary')}</CardTitle>
        <Link href={`/finance/orders/${customerOrderId}`} className="text-sm text-primary hover:underline">
          {t('viewInFinance')}
        </Link>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4 pt-0 sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">{t('actualCost')}</p>
          <p className="text-sm font-medium">{formatMoney(summary.actualCost, summary.primaryCurrency)}</p>
          <p className="text-[11px] text-muted-foreground">{t('actualCostHint')}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t('paid')}</p>
          <p className="text-sm font-medium">{formatMoney(summary.paid, summary.primaryCurrency)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t('unpaidPerDocuments')}</p>
          <p className="text-sm font-medium">{formatMoney(summary.unpaidPerDocuments, summary.primaryCurrency)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t('linkedPurchaseOrders')}</p>
          <p className="text-sm font-medium">{summary.purchaseOrders.length}</p>
        </div>
      </CardContent>
    </Card>
  );
}
