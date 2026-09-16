'use client';

import { useTranslations } from 'next-intl';
import { usePayrollFundSummary } from '@/lib/hooks/use-sales';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { formatEur } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { CollapsibleCard } from '@/components/domain/sales/collapsible-card';
import { OrderPayrollPrint } from '@/components/domain/sales/order-payroll-print';
import { useIsPrintPreview } from '@/components/domain/print/print-area';

/**
 * "Фонд заробітної плати на все замовлення" — REAL PayrollEntry ledger
 * (`earnedActual`), i.e. what's actually been earned/paid on this order,
 * plus the live BOM-rate "Оцінено по специфікаціях" breakdown.
 *
 * 2026-09-16 user request ("забери оцінено за поточними ставками закладено
 * фактично і блок виготовлено працівниками"): the frozen batch-start
 * estimate (`actual`) and the per-article "Виготовлено працівниками"
 * aggregate (`byArticle`) stay dropped — `getPayrollFundSummary` still
 * computes and returns them (used elsewhere, e.g.
 * CustomerOrdersService#getProfitReport reads `earnedActual` from the same
 * call), this widget just doesn't display them. The per-employee/per-article
 * breakdown that used to live in that dropped "Виготовлено працівниками"
 * table is still available, grouped by employee instead, in
 * `OrderPayrollByEmployee` (a sibling component, not part of this card).
 *
 * 2026-09-17 follow-up ("зник пункт оцінена заробітна плата... по
 * специфікаціях виробів, поверни"): the live estimate
 * (`estimated`/`estimatedByArticle`) is back — same "Оцінка по виробах (за
 * поточними ставками)" table as before, photo+article+qty+amount, always
 * expanded (no click needed). Deliberately has NO print button of its own
 * this time ("на друк не додавай цей пункт") — `OrderPayrollPrint` below
 * never included this breakdown to begin with, so leaving it out of print
 * needs no extra code, just not adding any.
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
 *
 * `useIsPrintPreview()` forces this card open on preview mode (2026-09-16
 * real bug found live — "коли натискаю переглянути... білий екран"): this
 * card starts collapsed on the Sales order page, so `OrderPayrollPrint`'s
 * `<PrintArea>` never mounts at all on a fresh preview-mode page load
 * unless something forces it open first — see useIsPrintPreview's own
 * header comment.
 */
export function PayrollFundWidget({ orderId, defaultOpen, orderLabel }: { orderId: string; defaultOpen?: boolean; orderLabel?: string }) {
  const t = useTranslations('sales');
  const { data: fund } = usePayrollFundSummary(orderId);
  const isPreview = useIsPrintPreview();
  const assemblyIds = fund?.estimatedByArticle.map((l) => l.assemblyId) ?? [];
  const { data: photosByAssembly } = useFilesForEntities('Assembly', assemblyIds, 'ASSEMBLY_PHOTO');
  if (!fund) return null;

  return (
    <CollapsibleCard title={t('payrollFund')} contentClassName="space-y-3" defaultOpen={defaultOpen || isPreview}>
      <OrderPayrollPrint orderId={orderId} orderLabel={orderLabel} />

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <div>
          <p className="text-xs text-muted-foreground">{t('payrollFundEstimated')}</p>
          <p className="text-sm font-medium">{formatEur(fund.estimated)}</p>
          <p className="text-[11px] text-muted-foreground">{t('payrollFundEstimatedHint')}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t('payrollFundEarned')}</p>
          <p className="text-sm font-medium">{formatEur(fund.earnedActual)}</p>
        </div>
      </div>

      {fund.estimatedByArticle.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">{t('payrollFundEstimatedByArticle')}</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('payrollFundArticle')}</TableHead>
                <TableHead>{t('payrollFundQtyNeeded')}</TableHead>
                <TableHead>{t('payrollFundEstimated')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fund.estimatedByArticle.map((line) => (
                <TableRow key={line.assemblyId}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar src={photosByAssembly?.[line.assemblyId]?.[0]?.downloadUrl} size="sm" />
                      <div className="min-w-0">
                        {line.article && <p className="truncate text-xs text-muted-foreground">{line.article}</p>}
                        <p className="max-w-[240px] truncate text-sm" title={line.assemblyName}>
                          {line.assemblyName}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{line.qtyNeeded}</TableCell>
                  <TableCell>{formatEur(line.estimatedAmount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </CollapsibleCard>
  );
}
