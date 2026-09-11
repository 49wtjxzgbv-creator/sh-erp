'use client';

import { useTranslations } from 'next-intl';
import { useProfitReport } from '@/lib/hooks/use-sales';
import { useCustomerOrderFinanceExpenses } from '@/lib/hooks/use-finance';
import { formatEur } from '@/lib/utils';
import { formatMoney } from '@/lib/finance-format';
import { PrintArea, PrintButton, PrintDocumentHeader, PreviewButton } from '@/components/domain/print/print-area';

/**
 * "Друк ПДФ" (2026-09-11 user request) — same browser-print-to-PDF mechanism
 * every other document in this app uses (PrintArea/window.print(), "Save as
 * PDF" in the browser's own print dialog — see print-area.tsx's own header
 * comment for why there's no separate server-side PDF generator). Five key
 * figures plus the raw additional-expense lines, same numbers the on-screen
 * ProfitReportWidget shows — printed from the same useProfitReport query so
 * the two can never drift apart.
 */
export function ProfitReportPrint({ orderId, orderLabel }: { orderId: string; orderLabel?: string }) {
  const t = useTranslations('sales');
  const tf = useTranslations('finance');
  const tp = useTranslations('print');
  const { data: report } = useProfitReport(orderId);
  const { data: expenses } = useCustomerOrderFinanceExpenses(orderId);
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
        <PrintButton label={tp('printProfitReport')} />
        <PreviewButton />
      </div>
      <PrintArea>
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

        {expenses && expenses.length > 0 && (
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
