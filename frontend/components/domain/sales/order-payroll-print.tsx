'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Printer } from 'lucide-react';
import { usePayrollFundSummary, useOrderPayrollByEmployee } from '@/lib/hooks/use-sales';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { formatEur, formatQty } from '@/lib/utils';
import { PrintArea, PrintDocumentHeader, PreviewButton } from '@/components/domain/print/print-area';
import { usePrintOptions } from '@/components/domain/print/print-options';
import { Button } from '@/components/ui/button';

/**
 * "Друк звіту по зарплаті замовлення" — the payroll picture for one order in
 * a single printable document: the real earned total (`earnedActual`) and
 * the per-employee breakdown (`getOrderPayrollByEmployee`). Same data the
 * two on-screen views (PayrollFundWidget, OrderPayrollByEmployee) show —
 * printed from the same hooks so the two can never drift apart.
 *
 * 2026-09-16 user request: dropped the estimated/frozen-actual fund figures
 * and the per-article "Виготовлено працівниками" aggregate from this
 * printout — same reduction as PayrollFundWidget's own header comment
 * describes. No column toggle needed anymore (a single section), so this
 * uses a plain button (matching production-progress-print.tsx's own
 * pattern) instead of the PrintOptionsDialog flow.
 *
 * Same visit's follow-up: article photos (a real `<img>`, not the on-screen
 * `Avatar` component — print output stays outside Next's image pipeline,
 * same convention the now-deleted PayrollFundEstimatePrint used), general
 * work labeled with its real `WorkTask.title` (not a generic fallback —
 * `assemblyName` carries that now, see CustomerOrdersService's own
 * getGeneralWorkPayrollEntries comment), and `unitsProduced` rounded to 2
 * decimals (real float drift observed live, e.g. "касета транспортерів").
 *
 * `usePrintOptions`/`printAreaId` — required, not optional: every page this
 * renders on already hosts other `<PrintArea>`s (Sales order page:
 * CustomerOrderPrint/ProductionProgressPrint/ProfitReportPrint; HR payroll
 * summary page: its own whole-summary and per-employee prints), each
 * starting `print-area--active` by default. See profit-report-print.tsx's
 * own header comment for the real bug this exact omission caused before
 * (2026-09-11: "не друкує сам звіт").
 */
export function OrderPayrollPrint({ orderId, orderLabel }: { orderId: string; orderLabel?: string }) {
  const t = useTranslations('sales');
  const th = useTranslations('hr');
  const tp = useTranslations('print');
  const { data: fund } = usePayrollFundSummary(orderId);
  const { data: byEmployee } = useOrderPayrollByEmployee(orderId);
  const printOptions = usePrintOptions({ columns: [] });
  const assemblyIds = useMemo(() => {
    const ids = new Set<string>();
    for (const line of byEmployee ?? []) for (const a of line.byArticle) if (a.assemblyId) ids.add(a.assemblyId);
    return Array.from(ids);
  }, [byEmployee]);
  const { data: photosByAssembly } = useFilesForEntities('Assembly', assemblyIds, 'ASSEMBLY_PHOTO');

  if (!fund) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => printOptions.confirm(new Set(), false)}>
          <Printer className="mr-2 h-4 w-4" />
          {tp('printOrderPayroll')}
        </Button>
        <PreviewButton />
      </div>
      <PrintArea printAreaId={printOptions.printAreaId}>
        <PrintDocumentHeader title={tp('orderPayrollTitle')} subtitle={orderLabel} />

        <table className="mb-4">
          <tbody>
            <tr>
              <td>{t('payrollFundEarned')}</td>
              <td className="font-bold">{formatEur(fund.earnedActual)}</td>
            </tr>
          </tbody>
        </table>

        {byEmployee && byEmployee.length > 0 && (
          <div>
            <h3 className="mb-2 font-semibold">{t('payrollByOrderPrintByEmployee')}</h3>
            {/* Same flat summary-table-then-per-employee-blocks layout as
                hr/payroll/summary/page.tsx's own whole-summary print — this
                IS that view's order-scoped sibling (2026-09-16 user
                request), so the two should read the same on paper. */}
            <table className="mb-4 w-full text-sm">
              <thead>
                <tr className="border-b-2 border-black text-left">
                  <th className="py-1 font-semibold">{th('employee')}</th>
                  <th className="py-1 text-right font-semibold">{t('payrollFundEarned')}</th>
                </tr>
              </thead>
              <tbody>
                {byEmployee.map((line) => (
                  <tr key={line.employeeId} className="border-b border-gray-300">
                    <td className="py-1">{line.employeeName}</td>
                    <td className="py-1 text-right font-medium tabular-nums">{formatEur(line.totalEarned)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-black font-bold">
                  <td className="py-1">{th('grandTotal')}</td>
                  <td className="py-1 text-right tabular-nums">{formatEur(byEmployee.reduce((sum, l) => sum + l.totalEarned, 0))}</td>
                </tr>
              </tbody>
            </table>
            <div className="space-y-3">
              {byEmployee.map((line) => (
                <div key={line.employeeId} className="break-inside-avoid border-b border-gray-300 pb-2">
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
                            <td>
                              {a.assemblyId ? `${a.article ? `${a.article} — ` : ''}${a.assemblyName}` : (a.assemblyName ?? t('payrollFundGeneralWork'))}
                            </td>
                            <td>{a.unitsProduced ? formatQty(a.unitsProduced) : '—'}</td>
                            <td>{formatEur(a.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </PrintArea>
    </>
  );
}
