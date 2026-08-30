'use client';

import { useTranslations } from 'next-intl';
import { usePayrollFundSummary } from '@/lib/hooks/use-sales';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { formatEur } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { CollapsibleCard } from '@/components/domain/sales/collapsible-card';

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
 */
export function PayrollFundWidget({ orderId, defaultOpen }: { orderId: string; defaultOpen?: boolean }) {
  const t = useTranslations('sales');
  const { data: fund } = usePayrollFundSummary(orderId);
  const assemblyIds = (fund?.byArticle ?? []).map((l) => l.assemblyId).filter((id): id is string => Boolean(id));
  const { data: photosByAssembly } = useFilesForEntities('Assembly', assemblyIds, 'ASSEMBLY_PHOTO');
  if (!fund) return null;

  return (
    <CollapsibleCard title={t('payrollFund')} contentClassName="space-y-3" defaultOpen={defaultOpen}>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <div>
          <p className="text-xs text-muted-foreground">{t('payrollFundEstimated')}</p>
          <p className="text-sm font-medium">{formatEur(fund.estimated)}</p>
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
