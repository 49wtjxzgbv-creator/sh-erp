'use client';

import { useTranslations } from 'next-intl';
import { formatEur, formatQty } from '@/lib/utils';
import type { PayrollByEmployeeLine } from '@/lib/api-client/sales';

/**
 * One employee's name/total header + article breakdown table (with photo,
 * WorkTask-title-aware general-work label, and qty rounded to 2 decimals) —
 * factored out (2026-09-16) so `OrderPayrollPrint`'s full-report per-employee
 * section and `OrderPayrollByEmployee`'s own single-employee print button
 * render byte-identical output instead of two copies of this table drifting
 * apart.
 */
export function EmployeePayrollPrintBlock({
  line,
  photosByAssembly,
}: {
  line: PayrollByEmployeeLine;
  photosByAssembly: Record<string, { downloadUrl: string }[]> | undefined;
}) {
  const t = useTranslations('sales');

  return (
    <div className="break-inside-avoid border-b border-gray-300 pb-2">
      <div className="mb-1 flex items-baseline justify-between">
        <p className="text-sm font-bold">{line.employeeName}</p>
        <p className="text-sm font-semibold">{formatEur(line.totalEarned)}</p>
      </div>
      {line.byArticle.length > 0 && (
        <table className="text-xs">
          <colgroup>
            <col className="print-photo-col" />
            <col />
            <col style={{ width: '20%' }} />
            <col style={{ width: '20%' }} />
          </colgroup>
          <thead>
            <tr>
              <th />
              <th>{t('payrollFundArticle')}</th>
              <th>{t('payrollFundUnitsProduced')}</th>
              <th>{t('payrollFundEarned')}</th>
            </tr>
          </thead>
          <tbody>
            {line.byArticle.map((a) => (
              <tr key={a.assemblyId ?? 'general'}>
                <td>
                  {a.assemblyId && photosByAssembly?.[a.assemblyId]?.[0]?.downloadUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- print output, outside Next's image pipeline
                    <img src={photosByAssembly[a.assemblyId][0].downloadUrl} alt="" style={{ width: 32, height: 32, objectFit: 'cover' }} />
                  ) : null}
                </td>
                <td>{a.assemblyId ? `${a.article ? `${a.article} — ` : ''}${a.assemblyName}` : (a.assemblyName ?? t('payrollFundGeneralWork'))}</td>
                <td>{a.unitsProduced ? formatQty(a.unitsProduced) : '—'}</td>
                <td>{formatEur(a.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
