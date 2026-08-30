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
}: {
  lines: PayrollEstimatedArticleLine[];
  photosByAssembly: Record<string, { downloadUrl: string }[]> | undefined;
  subtitle?: string;
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
          </tbody>
        </table>
      </PrintArea>
    </>
  );
}
