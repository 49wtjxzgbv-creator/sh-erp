'use client';

import { useTranslations } from 'next-intl';
import { usePayrollFundSummary, useOrderPayrollByEmployee } from '@/lib/hooks/use-sales';
import { formatEur } from '@/lib/utils';
import { PrintArea, PrintDocumentHeader, PreviewButton } from '@/components/domain/print/print-area';
import { usePrintOptions, PrintOptionsDialog, type PrintColumnOption } from '@/components/domain/print/print-options';

/**
 * "Друк звіту по зарплаті замовлення" (2026-09-16 user request) — the full
 * payroll picture for one order in a single printable document: fund
 * totals (Оцінено/Закладено фактично/Зароблено), the real earned-by-article
 * breakdown (`byArticle` — distinct from `estimatedByArticle`, which
 * PayrollFundEstimatePrint already covers on its own), and the per-employee
 * breakdown (`getOrderPayrollByEmployee`, which had no print view at all
 * before this). Same data these two already-shipped on-screen
 * views (PayrollFundWidget, OrderPayrollByEmployee) show — printed from the
 * same hooks so the two can never drift apart.
 *
 * `usePrintOptions`/`printAreaId` — required, not optional: every page this
 * renders on already hosts other `<PrintArea>`s (Sales order page:
 * CustomerOrderPrint/ProductionProgressPrint/PayrollFundEstimatePrint/
 * ProfitReportPrint; HR payroll summary page: its own whole-summary and
 * per-employee prints), each starting `print-area--active` by default. See
 * profit-report-print.tsx's own header comment for the real bug this
 * exact omission caused before (2026-09-11: "не друкує сам звіт").
 */
export function OrderPayrollPrint({ orderId, orderLabel }: { orderId: string; orderLabel?: string }) {
  const t = useTranslations('sales');
  const th = useTranslations('hr');
  const tp = useTranslations('print');
  const { data: fund } = usePayrollFundSummary(orderId);
  const { data: byEmployee } = useOrderPayrollByEmployee(orderId);

  const columns: PrintColumnOption[] = [
    { id: 'byArticle', label: t('payrollFundProducedByWorkers') },
    { id: 'byEmployee', label: t('payrollByOrderPrintByEmployee') },
  ];
  const printOptions = usePrintOptions({ columns });

  if (!fund) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <PrintOptionsDialog
          open={printOptions.open}
          onOpenChange={printOptions.setOpen}
          columns={columns}
          onConfirm={printOptions.confirm}
          triggerLabel={tp('printOrderPayroll')}
        />
        <PreviewButton />
      </div>
      <PrintArea printAreaId={printOptions.printAreaId}>
        <PrintDocumentHeader title={tp('orderPayrollTitle')} subtitle={orderLabel} />

        <table className="mb-4">
          <tbody>
            <tr>
              <td>{t('payrollFundEstimated')}</td>
              <td className="font-bold">{formatEur(fund.estimated)}</td>
            </tr>
            <tr>
              <td>{t('payrollFundActual')}</td>
              <td className="font-bold">{formatEur(fund.actual)}</td>
            </tr>
            <tr style={{ borderTop: '2px solid #333' }}>
              <td style={{ borderTop: '2px solid #333' }}>{t('payrollFundEarned')}</td>
              <td className="font-bold" style={{ borderTop: '2px solid #333' }}>
                {formatEur(fund.earnedActual)}
              </td>
            </tr>
          </tbody>
        </table>

        {printOptions.isColumnVisible('byArticle') && fund.byArticle.length > 0 && (
          <div className="mb-4">
            <h3 className="mb-1 font-semibold">{t('payrollFundProducedByWorkers')}</h3>
            <table>
              <thead>
                <tr>
                  <th>{t('payrollFundArticle')}</th>
                  <th>{t('payrollFundUnitsProduced')}</th>
                  <th>{t('payrollFundEarned')}</th>
                </tr>
              </thead>
              <tbody>
                {fund.byArticle.map((a) => (
                  <tr key={a.assemblyId ?? 'general'}>
                    <td>
                      {a.assemblyId
                        ? `${a.article ? `${a.article} — ` : ''}${a.assemblyName}`
                        : t('payrollFundGeneralWork')}
                    </td>
                    <td>{a.unitsProduced || '—'}</td>
                    <td>{formatEur(a.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {printOptions.isColumnVisible('byEmployee') && byEmployee && byEmployee.length > 0 && (
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
                      <thead>
                        <tr>
                          <th>{t('payrollFundArticle')}</th>
                          <th>{t('payrollFundUnitsProduced')}</th>
                          <th>{t('payrollFundEarned')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {line.byArticle.map((a) => (
                          <tr key={a.assemblyId ?? 'general'}>
                            <td>
                              {a.assemblyId
                                ? `${a.article ? `${a.article} — ` : ''}${a.assemblyName}`
                                : t('payrollFundGeneralWork')}
                            </td>
                            <td>{a.unitsProduced || '—'}</td>
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
