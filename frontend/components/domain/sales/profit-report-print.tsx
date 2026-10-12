'use client';

import { useTranslations } from 'next-intl';
import { useProfitReport } from '@/lib/hooks/use-sales';
import { useCustomerOrderFinanceExpenses, useCustomerOrderFinanceDocuments } from '@/lib/hooks/use-finance';
import { formatEur } from '@/lib/utils';
import { formatMoney } from '@/lib/finance-format';
import { PrintArea, PrintDocumentHeader, PreviewButton } from '@/components/domain/print/print-area';
import { usePrintOptions, PrintOptionsDialog, type PrintColumnOption } from '@/components/domain/print/print-options';

/**
 * "Друк ПДФ" (2026-09-11 user request) — same browser-print-to-PDF mechanism
 * every other document in this app uses (PrintArea/window.print(), "Save as
 * PDF" in the browser's own print dialog — see print-area.tsx's own header
 * comment for why there's no separate server-side PDF generator). Four key
 * figures plus the raw additional-expense lines, same numbers the on-screen
 * ProfitReportWidget shows — printed from the same useProfitReport query so
 * the two can never drift apart.
 *
 * "і в друкувати пдф і перегляд також має бути" (2026-10-12): the finance
 * documents section ProfitReportWidget's own on-screen DocumentsPanel just
 * gained needs the same print/preview treatment as the expenses lines
 * right below it — same `useCustomerOrderFinanceDocuments` query
 * DocumentsPanel itself reads, same optional-column gating as `expenses`.
 *
 * "зроби щоб можна було забирати статус оплати" (2026-10-13): a second,
 * independent toggle just for the payment-status column WITHIN the
 * documents table — some orders print this PDF for an external recipient
 * (the customer themselves) who has no reason to see internal payment
 * tracking, while the rest of the documents table (counterparty/amount)
 * still matters to them.
 *
 * MUST use `usePrintOptions`/`printAreaId`, not a plain `PrintButton` — this
 * order page already hosts several other `<PrintArea>`s (CustomerOrderPrint,
 * ProductionProgressPrint, OrderPayrollPrint), every one of which
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
  const { data: documents } = useCustomerOrderFinanceDocuments(orderId);

  const columns: PrintColumnOption[] = [
    { id: 'expenses', label: tf('directExpenses') },
    { id: 'documents', label: tf('directDocuments') },
    { id: 'documentsPaymentStatus', label: tf('filterByPaymentStatus') },
  ];
  const printOptions = usePrintOptions({ columns, id: 'profit-report-print' });

  if (!report) return null;

  const rows: [string, string][] = [
    [t('salePrice'), report.salePrice != null ? formatEur(report.salePrice) : t('pricePending')],
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
        <PreviewButton printAreaId={printOptions.printAreaId} />
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

        {printOptions.isColumnVisible('documents') && documents && documents.length > 0 && (
          <div className="mt-4">
            <h3 className="mb-1 font-semibold">{tf('directDocuments')}</h3>
            <table>
              <thead>
                <tr>
                  <th>{tf('counterparty')}</th>
                  <th>{tf('documentType')}</th>
                  <th>{tf('amount')}</th>
                  {printOptions.isColumnVisible('documentsPaymentStatus') && <th>{tf('filterByPaymentStatus')}</th>}
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.id}>
                    <td>{doc.counterparty?.name ?? '—'}</td>
                    <td>
                      {tf(`documentType${doc.documentType}`)}
                      {doc.documentNumber && ` · ${doc.documentNumber}`}
                      {doc.documentDate && ` · ${new Date(doc.documentDate).toLocaleDateString()}`}
                    </td>
                    <td>{doc.amount ? formatMoney(Number(doc.amount), doc.currency) : '—'}</td>
                    {printOptions.isColumnVisible('documentsPaymentStatus') && (
                      <td>{doc.paymentStatus === 'NO_AMOUNT' ? tf('documentPaymentStatusNO_AMOUNT') : tf(`paymentStatus${doc.paymentStatus}`)}</td>
                    )}
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
