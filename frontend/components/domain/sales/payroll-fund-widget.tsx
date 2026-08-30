'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { usePayrollFundSummary } from '@/lib/hooks/use-sales';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { formatEur } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { CollapsibleCard } from '@/components/domain/sales/collapsible-card';
import { PayrollFundEstimatePrint } from '@/components/domain/sales/payroll-fund-estimate-print';

/**
 * "Фонд заробітної плати на все замовлення" (2026-08-26 user request) —
 * estimated (live BOM labor rates, summed across every item's full
 * production tree, including sub-assemblies at any depth) vs actual
 * (frozen `laborCostEur`, summed across every already-started batch tied
 * to this order). Same estimated/actual pairing already used everywhere
 * else money is shown on the Sales order page.
 *
 * `earnedActual`/`byArticle` (2026-08-30 user request): "скільки вже
 * зароблено працівниками" — the REAL PayrollEntry ledger for this order's
 * batches, distinct from `actual` above (the frozen laborCostEur estimate
 * — these can differ). Below it, "Виготовлено працівниками": which
 * article/how many units/for what sum were actually produced so far, each
 * row led by the assembly's own photo + article.
 *
 * Extracted from sales/[id]/page.tsx (2026-08-30) so План виробництва's
 * order detail page can show it too — `defaultOpen` lets that standalone-
 * tab caller start expanded (the Sales page still starts collapsed).
 *
 * `estimatedByArticle` (2026-08-30 user request, always expanded per
 * follow-up — no click needed): every виріб in this order's production
 * tree with its own estimated labor cost — same photo+article row
 * convention as the byArticle table below it.
 */
export function PayrollFundWidget({ orderId, defaultOpen, orderLabel }: { orderId: string; defaultOpen?: boolean; orderLabel?: string }) {
  const t = useTranslations('sales');
  const { data: fund } = usePayrollFundSummary(orderId);
  const assemblyIds = useMemo(() => {
    const ids = new Set<string>();
    for (const l of fund?.byArticle ?? []) if (l.assemblyId) ids.add(l.assemblyId);
    for (const l of fund?.estimatedByArticle ?? []) ids.add(l.assemblyId);
    return Array.from(ids);
  }, [fund]);
  const { data: photosByAssembly } = useFilesForEntities('Assembly', assemblyIds, 'ASSEMBLY_PHOTO');
  if (!fund) return null;

  return (
    <CollapsibleCard title={t('payrollFund')} contentClassName="space-y-3" defaultOpen={defaultOpen}>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <div>
          <p className="text-xs text-muted-foreground">{t('payrollFundEstimated')}</p>
          <p className="text-sm font-medium">{formatEur(fund.estimated)}</p>
          <p className="text-[11px] text-muted-foreground">{t('payrollFundEstimatedHint')}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t('payrollFundActual')}</p>
          <p className="text-sm font-medium">{formatEur(fund.actual)}</p>
          <p className="text-[11px] text-muted-foreground">{t('payrollFundActualHint')}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t('payrollFundEarned')}</p>
          <p className="text-sm font-medium">{formatEur(fund.earnedActual)}</p>
        </div>
      </div>

      {fund.estimatedByArticle.length > 0 && (
        <div className="space-y-1.5">
          {/* PayrollFundEstimatePrint's own <PrintArea> must NOT sit inside a
              `no-print` ancestor — `.no-print`/`display:none` is inherited by
              every descendant with no way to escape it (unlike the
              visibility:hidden trick @media print itself uses, which a
              descendant CAN override). In preview mode (?print=1) the content
              portals out to #print-preview-root so this would go unnoticed;
              a REAL print (window.print() straight off this page, no portal)
              stayed literally display:none the whole time — "в перегляді є,
              а коли пускаю на друк то пустий листок" (2026-08-31 fix). Only
              the label needs no-print; the buttons already read fine in
              print (hidden via the same visibility trick as everything else
              outside .print-area--active). */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="no-print text-xs font-medium text-muted-foreground">{t('payrollFundEstimatedByArticle')}</p>
            <PayrollFundEstimatePrint lines={fund.estimatedByArticle} photosByAssembly={photosByAssembly} subtitle={orderLabel} total={fund.estimated} />
          </div>
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

      {fund.byArticle.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">{t('payrollFundProducedByWorkers')}</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('payrollFundArticle')}</TableHead>
                <TableHead>{t('payrollFundUnitsProduced')}</TableHead>
                <TableHead>{t('payrollFundEarned')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fund.byArticle.map((line) => (
                <TableRow key={line.assemblyId ?? 'general'}>
                  <TableCell>
                    {line.assemblyId ? (
                      <div className="flex items-center gap-2">
                        <Avatar src={photosByAssembly?.[line.assemblyId]?.[0]?.downloadUrl} size="sm" />
                        <div className="min-w-0">
                          {line.article && <p className="truncate text-xs text-muted-foreground">{line.article}</p>}
                          <p className="max-w-[240px] truncate text-sm" title={line.assemblyName ?? undefined}>
                            {line.assemblyName}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">{t('payrollFundGeneralWork')}</span>
                    )}
                  </TableCell>
                  <TableCell>{line.unitsProduced || '—'}</TableCell>
                  <TableCell>{formatEur(line.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </CollapsibleCard>
  );
}
