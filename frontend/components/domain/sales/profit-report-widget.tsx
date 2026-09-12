'use client';

import { useTranslations } from 'next-intl';
import { useProfitReport } from '@/lib/hooks/use-sales';
import { useHasPermission } from '@/lib/hooks/use-roles';
import { formatEur } from '@/lib/utils';
import { CollapsibleCard } from '@/components/domain/sales/collapsible-card';
import { ExpensesPanel } from '@/components/domain/finance/expenses-panel';
import { ProfitReportPrint } from '@/components/domain/sales/profit-report-print';

/**
 * "Прибуток по замовленню" — netProfit = salePrice - laborCost -
 * additionalExpenses (2026-09-12 user correction: production/materials cost
 * deliberately excluded — see CustomerOrdersService#getProfitReport's own
 * header comment). Gated behind `customer-orders:view-profit`, same
 * admin-sensitive treatment as Quotation margin fields — hidden entirely
 * without it, not just visually de-emphasized.
 *
 * Embeds the existing ExpensesPanel (kind="customer-order", the same one
 * Finance's own order page uses) so "додаткові витрати" can be entered right
 * here — deliberately not a second, parallel expense-entry form.
 */
export function ProfitReportWidget({ orderId, orderLabel }: { orderId: string; orderLabel?: string }) {
  const t = useTranslations('sales');
  const tf = useTranslations('finance');
  const canView = useHasPermission('customer-orders:view-profit');
  const canManageFinance = useHasPermission('finance:manage');
  const { data: report } = useProfitReport(canView ? orderId : undefined);
  if (!canView || !report) return null;

  return (
    <CollapsibleCard title={t('profitReport')} contentClassName="space-y-4">
      <ProfitReportPrint orderId={orderId} orderLabel={orderLabel} />

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <div>
          <p className="text-xs text-muted-foreground">{t('salePrice')}</p>
          <p className="text-sm font-medium">{report.salePrice != null ? formatEur(report.salePrice) : t('pricePending')}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t('profitLaborCost')}</p>
          <p className="text-sm font-medium">{formatEur(report.laborCost)}</p>
          <p className="text-[11px] text-muted-foreground">{t('profitLaborCostHint')}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t('profitAdditionalExpenses')}</p>
          <p className="text-sm font-medium">{formatEur(report.additionalExpenses)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t('netProfit')}</p>
          <p className={`text-base font-semibold ${report.netProfit != null && report.netProfit < 0 ? 'text-destructive' : ''}`}>
            {report.netProfit != null ? formatEur(report.netProfit) : t('pricePending')}
          </p>
        </div>
      </div>

      <ExpensesPanel kind="customer-order" ownerId={orderId} canManage={canManageFinance} title={tf('directExpenses')} />
    </CollapsibleCard>
  );
}
