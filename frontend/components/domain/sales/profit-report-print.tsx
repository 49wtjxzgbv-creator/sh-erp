'use client';

import { useTranslations } from 'next-intl';
import { useProfitReport } from '@/lib/hooks/use-sales';
import { useCustomerOrderFinanceExpenses } from '@/lib/hooks/use-finance';
import { formatEur } from '@/lib/utils';
import { formatMoney } from '@/lib/finance-format';
import { PrintArea, PrintDocumentHeader, PreviewButton } from '@/components/domain/print/print-area';
import { usePrintOptions, PrintOptionsDialog, type PrintColumnOption } from '@/components/domain/print/print-options';

/**
 * "Друк ПДФ" (2026-09-11 user request) — same browser-print-to-PDF mechanism
 * every other document in this app uses (PrintArea/window.print(), "Save as
 * PDF" in the browser's own print dialog — see print-area.tsx's own header
 * comment for why there's no separate server-side PDF generator). Five key
 * figures plus the raw additional-expense lines, same numbers the on-screen
 * ProfitReportWidget shows — printed from the same useProfitReport query so
 * the two can never drift apart.
 *
 * MUST use `usePrintOptions`/`printAreaId`, not a plain `PrintButton` — this
 * order page already hosts several other `<PrintArea>`s (CustomerOrderPrint,
 * ProductionProgressPrint, PayrollFundEstimatePrint), every one of which
 * starts `print-area--active` by default (print-area.tsx). A plain
 * `window.print()` here left every one of them active at once — real
 * reported bug (2026-09-11: "не друкує сам звіт"), the printed output was
 * whichever OTHER print area's content won the resulting `position:
 * absolute; inset: 0` stack, not this one. `usePrintOptions` deactivates
 * every other print area right before firing `window.print()` — see that
 * hook's own header comment for the full regression history
 * (production/[id]/page.tsx hit the identical bug first, 2026-08-25).
 */
export function ProfitReportPrint({ orderId, orderLabel }: { orderId: string; orderLabel?: string }) {
  const t = useTranslations('sales');
  const tf = useTranslations('finance');
  const tp = useTranslations('print');
  const { data: report } = useProfitReport(orderId);
  const { data: expenses } = useCustomerOrderFinanceExpenses(orderId);

  const columns: PrintColumnOption[] = [{ id: 'expenses', label: tf('directExpenses') }];
  const printOptions = usePrintOptions({ columns });

  if (!report) return null;

  const rows: [string, string][] = [
    [t('salePrice'), report.salePrice != null ? formatEur(report.salePrice) : t('pricePending')],
    [t('profitProductionCost'), report.productionCost != null ? formatEur(report.productionCost) : t('pricePending')],
    [t('profitLaborCost'), formatEur(report.laborCost)],
    [t('profitAdditionalExpenses'), formatEur(report.additionalExpenses)],
    [t('netProfit'), report.netProfit != null ? formatEur(report.netProfit) : t('pricePending')],
  ];

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <PrintOptionsDialog
          open={printOptions.open}
          onOpenChange={printOptions.setOpen}
          columns={columns}
          onConfirm={printOptions.confirm}
          triggerLabel={tp('printProfitReport')}
        />
        <PreviewButton />
      </div>
      <PrintArea printAreaId={printOptions.printAreaId}>
        <PrintDocumentHeader title={tp('profitReportTitle')} subtitle={orderLabel} />
        <table className="mb-4">
          <tbody>
            {rows.map(([label, value], i) => {
              const isLast = i === rows.length - 1;
              return (
                <tr key={label}>
                  <td style={isLast ? { borderTop: '2px solid #333' } : undefined}>{label}</td>
                  <td className="font-bold" style={isLast ? { borderTop: '2px solid #333' } : undefined}>
                    {value}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {printOptions.isColumnVisible('expenses') && expenses && expenses.length > 0 && (
          <div>
            <h3 className="mb-1 font-semibold">{tf('directExpenses')}</h3>
            <table>
              <thead>
                <tr>
                  <th>{tf('category')}</th>
                  <th>{tf('description')}</th>
                  <th>{tf('amount')}</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((exp) => (
                  <tr key={exp.id}>
                    <td>{tf(`expenseCategory${exp.category}`)}</td>
                    <td>{exp.description || '—'}</td>
                    <td>{formatMoney(Number(exp.amount), exp.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PrintArea>
    </>
  );
}
