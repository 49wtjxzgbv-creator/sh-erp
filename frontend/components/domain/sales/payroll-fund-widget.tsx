'use client';

import { useTranslations } from 'next-intl';
import { usePayrollFundSummary } from '@/lib/hooks/use-sales';
import { formatEur } from '@/lib/utils';
import { CollapsibleCard } from '@/components/domain/sales/collapsible-card';
import { OrderPayrollPrint } from '@/components/domain/sales/order-payroll-print';

/**
 * "Фонд заробітної плати на все замовлення" — REAL PayrollEntry ledger
 * (`earnedActual`), i.e. what's actually been earned/paid on this order.
 *
 * 2026-09-16 user request ("забери оцінено за поточними ставками закладено
 * фактично і блок виготовлено працівниками"): the live BOM-rate estimate
 * (`estimated`/`estimatedByArticle`), the frozen batch-start estimate
 * (`actual`), and the per-article "Виготовлено працівниками" aggregate
 * (`byArticle`) were all dropped from this card — `getPayrollFundSummary`
 * still computes and returns them (used elsewhere, e.g.
 * CustomerOrdersService#getProfitReport reads `earnedActual` from the same
 * call), this widget just no longer displays them. The
 * per-employee/per-article breakdown that used to live in the dropped
 * "Виготовлено працівниками" table is still available, grouped by employee
 * instead, in `OrderPayrollByEmployee` (a sibling component, not part of
 * this card).
 *
 * Extracted from sales/[id]/page.tsx (2026-08-30) so План виробництва's
 * order detail page can show it too — `defaultOpen` lets that standalone-
 * tab caller start expanded (the Sales page still starts collapsed).
 *
 * `OrderPayrollPrint` (2026-09-16 user request — "друкувати звіт по зарплаті
 * конкретного замовлення"): full-report print button up top, covering this
 * card's own `earnedActual` plus the per-employee breakdown in one
 * document. Embedded here (not a separate per-page addition) so every
 * existing caller of this widget (Sales order page, HR's "Зарплата по
 * замовленню" lookup, План виробництва's order detail) gets it for free.
 */
export function PayrollFundWidget({ orderId, defaultOpen, orderLabel }: { orderId: string; defaultOpen?: boolean; orderLabel?: string }) {
  const t = useTranslations('sales');
  const { data: fund } = usePayrollFundSummary(orderId);
  if (!fund) return null;

  return (
    <CollapsibleCard title={t('payrollFund')} contentClassName="space-y-3" defaultOpen={defaultOpen}>
      <OrderPayrollPrint orderId={orderId} orderLabel={orderLabel} />

      <div>
        <p className="text-xs text-muted-foreground">{t('payrollFundEarned')}</p>
        <p className="text-sm font-medium">{formatEur(fund.earnedActual)}</p>
      </div>
    </CollapsibleCard>
  );
}
