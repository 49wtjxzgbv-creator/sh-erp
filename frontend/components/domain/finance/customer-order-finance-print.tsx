'use client';

import { useTranslations } from 'next-intl';
import {
  useCustomerOrderFinanceSummary,
  useCustomerOrderFinanceDocuments,
  useCustomerOrderFinanceExpenses,
  useFinanceDocuments,
  useFinanceExpenses,
} from '@/lib/hooks/use-finance';
import { formatMoney } from '@/lib/finance-format';
import type {
  CustomerOrderDocument,
  PurchaseOrderDocument,
  CustomerOrderExpense,
  PurchaseOrderExpense,
  CustomerOrderFinanceSummary,
} from '@/lib/api-client/finance';
import { PrintArea, PrintDocumentHeader, PreviewButton } from '@/components/domain/print/print-area';
import { usePrintOptions, PrintOptionsDialog, type PrintColumnOption } from '@/components/domain/print/print-options';

function SummaryPrintBlock({ summary }: { summary: CustomerOrderFinanceSummary }) {
  const t = useTranslations('finance');
  const rows: [string, number][] = [
    [t('purchaseCost'), summary.purchaseCost],
    [t('additionalExpenses'), summary.additionalExpenses],
    [t('actualCost'), summary.actualCost],
    [t('paid'), summary.paid],
    [t('unpaidPerDocuments'), summary.unpaidPerDocuments],
  ];
  return (
    <table className="mb-4">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <td>{label}</td>
            <td className="font-bold">{formatMoney(value, summary.primaryCurrency)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One document table (documentType/number/date/counterparty/amount/status/paid/remaining) plus, below it, a flat "who was paid how much and when" payments list — this is the "хто кому скільки заплатили, винні" part of the printout. */
function DocumentsPrintSection({ title, documents }: { title: string; documents: (PurchaseOrderDocument | CustomerOrderDocument)[] }) {
  const t = useTranslations('finance');
  if (documents.length === 0) return null;

  return (
    // No break-inside-avoid here — see assembly-spec-print.tsx's
    // AssemblyCompositionSection for the real print regression this class of
    // "whole div must stay on one page" wrapper causes once its table grows
    // past a single page's remaining height (rows overlapping instead of
    // paginating). Per-row avoidance (globals.css's `.print-area tr`) is
    // already correct and sufficient.
    <div className="mb-4">
      <h3 className="mb-1 font-semibold">{title}</h3>
      <table>
        <thead>
          <tr>
            <th>{t('documentType')}</th>
            <th>{t('documentNumber')}</th>
            <th>{t('documentDate')}</th>
            <th>{t('counterparty')}</th>
            <th>{t('amount')}</th>
            <th>{t('status')}</th>
            <th>{t('paid')}</th>
            <th>{t('remainingBalance')}</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => {
            const paidSameCurrency = doc.payments.filter((p) => p.currency === doc.currency).reduce((sum, p) => sum + Number(p.amount), 0);
            const remaining = doc.amount ? Math.max(Number(doc.amount) - paidSameCurrency, 0) : 0;
            return (
              <tr key={doc.id}>
                <td>{t(`documentType${doc.documentType}`)}</td>
                <td>{doc.documentNumber || '—'}</td>
                <td>{doc.documentDate ? new Date(doc.documentDate).toLocaleDateString() : '—'}</td>
                <td>{doc.counterparty?.name ?? '—'}</td>
                <td>{doc.amount ? formatMoney(Number(doc.amount), doc.currency) : '—'}</td>
                <td>{doc.paymentStatus === 'NO_AMOUNT' ? t('documentPaymentStatusNO_AMOUNT') : t(`paymentStatus${doc.paymentStatus}`)}</td>
                <td>{formatMoney(paidSameCurrency, doc.currency)}</td>
                <td className="font-bold">{formatMoney(remaining, doc.currency)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {documents.some((d) => d.payments.length > 0) && (
        <div className="mt-1 text-sm">
          <p className="font-medium">{t('payments')}:</p>
          <ul>
            {documents.flatMap((doc) =>
              doc.payments.map((p) => (
                <li key={p.id}>
                  {doc.counterparty?.name ?? doc.documentNumber ?? t(`documentType${doc.documentType}`)} — {formatMoney(Number(p.amount), p.currency)}
                  {' · '}
                  {new Date(p.paidAt).toLocaleDateString()}
                  {p.method ? ` · ${p.method}` : ''}
                </li>
              )),
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function ExpensesPrintSection({ title, expenses }: { title: string; expenses: (PurchaseOrderExpense | CustomerOrderExpense)[] }) {
  const t = useTranslations('finance');
  if (expenses.length === 0) return null;

  return (
    <div className="mb-4">
      <h3 className="mb-1 font-semibold">{title}</h3>
      <table>
        <thead>
          <tr>
            <th>{t('category')}</th>
            <th>{t('description')}</th>
            <th>{t('amount')}</th>
          </tr>
        </thead>
        <tbody>
          {expenses.map((exp) => (
            <tr key={exp.id}>
              <td>{t(`expenseCategory${exp.category}`)}</td>
              <td>{exp.description || '—'}</td>
              <td>{formatMoney(Number(exp.amount), exp.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One linked PurchaseOrder's own documents/payments/expenses, fetched here (not from the summary rollup, which only carries numbers) — mirrors LinkedPurchaseOrdersPanel on the screen page. */
function LinkedPurchaseOrderFinanceSection({
  purchaseOrderId,
  supplierName,
  orderDate,
}: {
  purchaseOrderId: string;
  supplierName: string;
  orderDate: string;
}) {
  const t = useTranslations('finance');
  const { data: documents } = useFinanceDocuments(purchaseOrderId);
  const { data: expenses } = useFinanceExpenses(purchaseOrderId);

  return (
    <div className="mb-6">
      <p className="mb-1 font-semibold">
        {supplierName} · {new Date(orderDate).toLocaleDateString()}
      </p>
      <DocumentsPrintSection title={t('documents')} documents={documents ?? []} />
      <ExpensesPrintSection title={t('expenses')} expenses={expenses ?? []} />
    </div>
  );
}

/** Full financial printout for a CustomerOrder: summary, direct documents/payments/expenses, and every linked PurchaseOrder's own documents/payments/expenses — "хто кому скільки заплатили, винні" in one document. */
export function CustomerOrderFinancePrint({ customerOrderId, orderLabel }: { customerOrderId: string; orderLabel: string }) {
  const t = useTranslations('finance');
  const tp = useTranslations('print');

  const { data: summary } = useCustomerOrderFinanceSummary(customerOrderId);
  const { data: directDocuments } = useCustomerOrderFinanceDocuments(customerOrderId);
  const { data: directExpenses } = useCustomerOrderFinanceExpenses(customerOrderId);

  const columns: PrintColumnOption[] = [
    { id: 'summary', label: t('financeSummary') },
    { id: 'linkedPurchaseOrders', label: t('linkedPurchaseOrders') },
    { id: 'directDocuments', label: t('directDocuments') },
    { id: 'directExpenses', label: t('directExpenses') },
  ];
  const printOptions = usePrintOptions({ columns });

  return (
    <>
      <div className="flex gap-2">
        <PrintOptionsDialog
          open={printOptions.open}
          onOpenChange={printOptions.setOpen}
          columns={columns}
          onConfirm={printOptions.confirm}
          triggerLabel={tp('printFinance')}
        />
        <PreviewButton />
      </div>
      <PrintArea printAreaId={printOptions.printAreaId}>
        <PrintDocumentHeader title={tp('financeTitle')} subtitle={orderLabel} />
        {printOptions.isColumnVisible('summary') && summary && <SummaryPrintBlock summary={summary} />}
        {printOptions.isColumnVisible('directDocuments') && (
          <DocumentsPrintSection title={t('directDocuments')} documents={directDocuments ?? []} />
        )}
        {printOptions.isColumnVisible('directExpenses') && (
          <ExpensesPrintSection title={t('directExpenses')} expenses={directExpenses ?? []} />
        )}
        {printOptions.isColumnVisible('linkedPurchaseOrders') && summary && summary.purchaseOrders.length > 0 && (
          <div>
            <h2 className="mb-2 text-base font-semibold">{t('linkedPurchaseOrders')}</h2>
            {summary.purchaseOrders.map((p) => (
              <LinkedPurchaseOrderFinanceSection
                key={p.purchaseOrder.id}
                purchaseOrderId={p.purchaseOrder.id}
                supplierName={p.purchaseOrder.supplierNameSnapshot}
                orderDate={p.purchaseOrder.orderDate}
              />
            ))}
          </div>
        )}
      </PrintArea>
    </>
  );
}
