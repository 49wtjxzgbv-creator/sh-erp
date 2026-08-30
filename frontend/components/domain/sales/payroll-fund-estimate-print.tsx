'use client';

import { useTranslations } from 'next-intl';
import { formatEur } from '@/lib/utils';
import type { PayrollEstimatedArticleLine } from '@/lib/api-client/sales';
import { PrintArea, PrintButton, PrintDocumentHeader, PreviewButton } from '@/components/domain/print/print-area';

/**
 * "Друкувати оцінку по виробах" (2026-08-31 user request) — the payroll
 * fund's "Оцінка по виробах (за поточними ставками)" breakdown, printed as
 * a plain table (photo/article/name/qty/estimated), same shape as the
 * on-screen one. A real `<table>`, not the on-screen div-based Table
 * primitive — `.print-area table/th/td` (globals.css) already styles a
 * semantic table for print (repeating `<thead>` across pages, borders,
 * the `.print-photo-col` width helper), same convention every other print
 * view in this app already follows (production-progress-print.tsx etc.).
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

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <PrintButton label={tp('printPayrollEstimate')} />
        <PreviewButton />
      </div>
      <PrintArea>
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
