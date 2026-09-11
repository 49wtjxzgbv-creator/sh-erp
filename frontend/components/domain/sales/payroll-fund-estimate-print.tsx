'use client';

import { useTranslations } from 'next-intl';
import { Printer } from 'lucide-react';
import { formatEur } from '@/lib/utils';
import type { PayrollEstimatedArticleLine } from '@/lib/api-client/sales';
import { PrintArea, PrintDocumentHeader, PreviewButton } from '@/components/domain/print/print-area';
import { usePrintOptions } from '@/components/domain/print/print-options';
import { Button } from '@/components/ui/button';

/**
 * "Друкувати оцінку по виробах" (2026-08-31 user request) — the payroll
 * fund's "Оцінка по виробах (за поточними ставками)" breakdown, printed as
 * a plain table (photo/article/name/qty/estimated), same shape as the
 * on-screen one. A real `<table>`, not the on-screen div-based Table
 * primitive — `.print-area table/th/td` (globals.css) already styles a
 * semantic table for print (repeating `<thead>` across pages, borders,
 * the `.print-photo-col` width helper), same convention every other print
 * view in this app already follows (production-progress-print.tsx etc.).
 *
 * `usePrintOptions`/`printAreaId` (no columns — the table always prints in
 * full) — needed for activate-only-this-print-area, not just cosmetics: this
 * order page hosts several other `<PrintArea>`s at once (CustomerOrderPrint,
 * ProductionProgressPrint, ProfitReportPrint), each starting
 * `print-area--active` by default. A plain `window.print()` here left all of
 * them active simultaneously — real reported bug (2026-09-11), same root
 * cause as production-progress-print.tsx's own fix (see that file's header
 * comment).
 */
export function PayrollFundEstimatePrint({
  lines,
  photosByAssembly,
  subtitle,
  total,
}: {
  lines: PayrollEstimatedArticleLine[];
  photosByAssembly: Record<string, { downloadUrl: string }[]> | undefined;
  subtitle?: string;
  /** Same `fund.estimated` figure the on-screen "Оцінено (за поточними ставками)" shows — passed in rather than re-summed here so the printed total always matches it exactly (per-line amounts are independently rounded, so summing them here could drift by a cent). */
  total: number;
}) {
  const t = useTranslations('sales');
  const tCatalog = useTranslations('catalog');
  const tp = useTranslations('print');
  const printOptions = usePrintOptions({ columns: [] });

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => printOptions.confirm(new Set(), false)}>
          <Printer className="mr-2 h-4 w-4" />
          {tp('printPayrollEstimate')}
        </Button>
        <PreviewButton />
      </div>
      <PrintArea printAreaId={printOptions.printAreaId}>
        <PrintDocumentHeader title={tp('payrollEstimateTitle')} subtitle={subtitle} />
        <table>
          <colgroup>
            <col className="print-photo-col" />
            <col />
            <col style={{ width: '15%' }} />
            <col style={{ width: '20%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>{tCatalog('photo')}</th>
              <th>{t('assembly')}</th>
              <th>{t('payrollFundQtyNeeded')}</th>
              <th>{t('payrollFundEstimated')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.assemblyId}>
                <td>
                  {photosByAssembly?.[line.assemblyId]?.[0]?.downloadUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- print output, outside Next's image pipeline
                    <img src={photosByAssembly[line.assemblyId][0].downloadUrl} alt="" style={{ width: 48, height: 48, objectFit: 'cover' }} />
                  ) : null}
                </td>
                <td>
                  {line.article && <div style={{ color: '#666', fontSize: 10 }}>{line.article}</div>}
                  {line.assemblyName}
                </td>
                <td>{line.qtyNeeded}</td>
                <td>{formatEur(line.estimatedAmount)}</td>
              </tr>
            ))}
            {/* A `<tfoot>` row repeats on every printed page once the table
                spans more than one (same browser behavior as `<thead>`) —
                "щоб при друці він був не на кожній сторінці, а в кінці
                списка" (2026-08-31). A plain last `<tbody>` row prints
                exactly once, at the true end of the list. */}
            <tr>
              <td colSpan={3} style={{ textAlign: 'right', fontWeight: 700, borderTop: '2px solid #333' }}>
                {t('payrollFundEstimatedTotal')}
              </td>
              <td style={{ fontWeight: 700, borderTop: '2px solid #333' }}>{formatEur(total)}</td>
            </tr>
          </tbody>
        </table>
        <p style={{ marginTop: 6, fontSize: 10, color: '#666' }}>{t('payrollFundEstimatedHint')}</p>
      </PrintArea>
    </>
  );
}
