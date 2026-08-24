'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  useCustomerOrderFinanceSummary,
  useCustomerOrderFinanceDocuments,
  useCustomerOrderFinanceExpenses,
  useCreateCustomerOrderDocument,
  useCreateCustomerOrderExpense,
  useDeleteCustomerOrderExpense,
} from '@/lib/hooks/use-finance';
import { useCustomerOrder } from '@/lib/hooks/use-sales';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { formatMoney } from '@/lib/finance-format';
import { useHasPermission } from '@/lib/hooks/use-roles';
import type {
  PurchaseOrderDocumentType,
  PurchaseOrderExpenseCategory,
  DocumentPaymentStatus,
  FinancePaymentStatus,
} from '@/lib/api-client/finance';
import { SupplierPicker } from '@/components/domain/procurement/supplier-picker';
import { DocumentDrawer } from '@/components/domain/finance/document-drawer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { LoadingBlock } from '@/components/ui/loading-block';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

const DOCUMENT_TYPES: PurchaseOrderDocumentType[] = [
  'INVOICE', 'DELIVERY_NOTE', 'PROFORMA_INVOICE', 'PACKING_LIST', 'TRANSPORT_DOCUMENT', 'CUSTOMS_DOCUMENT', 'ACT', 'OTHER',
];
const EXPENSE_CATEGORIES: PurchaseOrderExpenseCategory[] = ['SHIPPING', 'CUSTOMS', 'INSURANCE', 'OTHER'];

const DOCUMENT_STATUS_VARIANT: Record<DocumentPaymentStatus, 'secondary' | 'warning' | 'success' | 'outline'> = {
  NO_AMOUNT: 'outline',
  UNPAID: 'secondary',
  PARTIAL: 'warning',
  PAID: 'success',
};

const PO_STATUS_VARIANT: Record<FinancePaymentStatus, 'secondary' | 'warning' | 'success'> = {
  UNPAID: 'secondary',
  PARTIAL: 'warning',
  PAID: 'success',
};

/**
 * CustomerOrder-Finance (2026-08-24 pivot). Cost = automatic rollup of
 * every linked PurchaseOrder's own Finance data (see the "Закупівлі"
 * section below — reused as-is, no duplication) + direct documents/
 * expenses recorded here on the order itself.
 */
function SummaryCard({ customerOrderId }: { customerOrderId: string }) {
  const t = useTranslations('finance');
  const { data: summary } = useCustomerOrderFinanceSummary(customerOrderId);
  if (!summary) return null;

  const rows: [string, number][] = [
    [t('purchaseCost'), summary.purchaseCost],
    [t('additionalExpenses'), summary.additionalExpenses],
    [t('actualCost'), summary.actualCost],
    [t('paid'), summary.paid],
    [t('unpaidPerDocuments'), summary.unpaidPerDocuments],
  ];

  return (
    <Card>
      <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 pt-6 sm:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label}>
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-lg font-semibold">{formatMoney(value, summary.primaryCurrency)}</div>
          </div>
        ))}
        <div>
          <div className="text-xs text-muted-foreground">{t('documentCount')}</div>
          <div className="text-lg font-semibold">{summary.documentCount}</div>
        </div>
        {summary.otherCurrencies.map((bucket) => (
          <div key={bucket.currency} className="col-span-2 rounded-md border border-dashed p-2 text-xs sm:col-span-3">
            <span className="font-medium">{bucket.currency}: </span>
            {t('additionalExpenses')} {formatMoney(bucket.additionalExpenses, bucket.currency)} ·{' '}
            {t('totalDocuments')} {formatMoney(bucket.totalDocuments, bucket.currency)} ·{' '}
            {t('paid')} {formatMoney(bucket.paid, bucket.currency)} ·{' '}
            {t('unpaidPerDocuments')} {formatMoney(bucket.unpaidPerDocuments, bucket.currency)}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** Rollup section — every linked PurchaseOrder, each with its own already-built Finance summary. Reused, not duplicated: clicking a card goes to the exact same /finance/purchase-orders/[id] page the Закупівлі tab links to. */
function LinkedPurchaseOrdersPanel({ customerOrderId }: { customerOrderId: string }) {
  const t = useTranslations('finance');
  const { data: summary } = useCustomerOrderFinanceSummary(customerOrderId);
  const purchaseOrders = summary?.purchaseOrders ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('linkedPurchaseOrders')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {purchaseOrders.length === 0 && <p className="text-sm text-muted-foreground">{t('noLinkedPurchaseOrders')}</p>}
        {purchaseOrders.map((p) => (
          <Link
            key={p.purchaseOrder.id}
            href={`/finance/purchase-orders/${p.purchaseOrder.id}`}
            className="flex items-center justify-between rounded-md border p-3 text-sm transition-colors hover:border-primary/50"
          >
            <div>
              <div className="font-medium">{p.purchaseOrder.supplierNameSnapshot}</div>
              <div className="text-xs text-muted-foreground">{new Date(p.purchaseOrder.orderDate).toLocaleDateString()}</div>
            </div>
            <div className="flex items-center gap-2">
              <span>{formatMoney(p.summary.actualCost, p.summary.primaryCurrency)}</span>
              <Badge variant={PO_STATUS_VARIANT[p.summary.paid >= p.summary.totalDocuments && p.summary.totalDocuments > 0 ? 'PAID' : p.summary.paid > 0 ? 'PARTIAL' : 'UNPAID']}>
                {t(`paymentStatus${p.summary.paid >= p.summary.totalDocuments && p.summary.totalDocuments > 0 ? 'PAID' : p.summary.paid > 0 ? 'PARTIAL' : 'UNPAID'}`)}
              </Badge>
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

function NewDocumentDialog({ customerOrderId }: { customerOrderId: string }) {
  const t = useTranslations('finance');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const createDocument = useCreateCustomerOrderDocument(customerOrderId);
  const [open, setOpen] = useState(false);
  const [documentType, setDocumentType] = useState<PurchaseOrderDocumentType>('INVOICE');
  const [documentNumber, setDocumentNumber] = useState('');
  const [documentDate, setDocumentDate] = useState('');
  const [counterpartyId, setCounterpartyId] = useState<string | undefined>();
  const [counterpartyLabel, setCounterpartyLabel] = useState<string | undefined>();
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setDocumentType('INVOICE');
    setDocumentNumber('');
    setDocumentDate('');
    setCounterpartyId(undefined);
    setAmount('');
    setCurrency('EUR');
    setNote('');
    setError(null);
  }

  async function handleSubmit() {
    setError(null);
    if (!counterpartyId) {
      setError(t('counterparty'));
      return;
    }
    try {
      await createDocument.mutateAsync({
        documentType,
        documentNumber: documentNumber || undefined,
        documentDate: documentDate || undefined,
        counterpartyId,
        amount: amount ? Number(amount) : undefined,
        currency,
        note: note || undefined,
      });
      setOpen(false);
      reset();
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm">{t('addDocument')}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('addDocument')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>{t('documentType')}</Label>
            <Select value={documentType} onValueChange={(v) => setDocumentType(v as PurchaseOrderDocumentType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOCUMENT_TYPES.map((v) => <SelectItem key={v} value={v}>{t(`documentType${v}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="doc-number">{t('documentNumber')}</Label>
              <Input id="doc-number" value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="doc-date">{t('documentDate')}</Label>
              <Input id="doc-date" type="date" value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>{t('counterparty')}</Label>
            <SupplierPicker value={counterpartyId} initialLabel={counterpartyLabel} onChange={(id, label) => { setCounterpartyId(id); setCounterpartyLabel(label); }} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="doc-amount">{t('amount')}</Label>
              <Input id="doc-amount" type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="doc-currency">{t('currency')}</Label>
              <Input id="doc-currency" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t('amountOptionalHint')}</p>
          <div className="space-y-1">
            <Label htmlFor="doc-note">{t('note')}</Label>
            <Textarea id="doc-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={createDocument.isPending}>{t('create')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocumentsPanel({ customerOrderId, canManage }: { customerOrderId: string; canManage: boolean }) {
  const t = useTranslations('finance');
  const { data: documents } = useCustomerOrderFinanceDocuments(customerOrderId);
  const [openDocumentId, setOpenDocumentId] = useState<string | undefined>();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{t('directDocuments')}</CardTitle>
        {canManage && <NewDocumentDialog customerOrderId={customerOrderId} />}
      </CardHeader>
      <CardContent className="space-y-2">
        {(documents?.length ?? 0) === 0 && <p className="text-sm text-muted-foreground">{t('noDocuments')}</p>}
        {documents?.map((doc) => (
          <button
            key={doc.id}
            type="button"
            onClick={() => setOpenDocumentId(doc.id)}
            className="flex w-full items-center justify-between rounded-md border p-3 text-left text-sm transition-colors hover:border-primary/50"
          >
            <div>
              <div className="font-medium">{doc.documentNumber || t(`documentType${doc.documentType}`)}</div>
              <div className="text-xs text-muted-foreground">
                {t(`documentType${doc.documentType}`)} · {doc.counterparty?.name}
                {doc.documentDate && ` · ${new Date(doc.documentDate).toLocaleDateString()}`}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {doc.amount && <span>{formatMoney(Number(doc.amount), doc.currency)}</span>}
              <Badge variant={DOCUMENT_STATUS_VARIANT[doc.paymentStatus]}>
                {doc.paymentStatus === 'NO_AMOUNT' ? t('documentPaymentStatusNO_AMOUNT') : t(`paymentStatus${doc.paymentStatus}`)}
              </Badge>
            </div>
          </button>
        ))}
      </CardContent>
      <DocumentDrawer
        kind="customer-order"
        ownerId={customerOrderId}
        documentId={openDocumentId}
        open={Boolean(openDocumentId)}
        onOpenChange={(o) => !o && setOpenDocumentId(undefined)}
        canManage={canManage}
      />
    </Card>
  );
}

function NewExpenseDialog({ customerOrderId, documentOptions }: { customerOrderId: string; documentOptions: { id: string; label: string }[] }) {
  const t = useTranslations('finance');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const createExpense = useCreateCustomerOrderExpense(customerOrderId);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<PurchaseOrderExpenseCategory>('SHIPPING');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [description, setDescription] = useState('');
  const [documentId, setDocumentId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setCategory('SHIPPING');
    setAmount('');
    setCurrency('EUR');
    setDescription('');
    setDocumentId(undefined);
    setError(null);
  }

  async function handleSubmit() {
    setError(null);
    const value = Number(amount);
    if (!value || value <= 0) {
      setError(t('amount'));
      return;
    }
    try {
      await createExpense.mutateAsync({ category, amount: value, currency, description: description || undefined, documentId });
      setOpen(false);
      reset();
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm">{t('addExpense')}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('addExpense')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>{t('category')}</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as PurchaseOrderExpenseCategory)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {EXPENSE_CATEGORIES.map((v) => <SelectItem key={v} value={v}>{t(`expenseCategory${v}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="exp-amount">{t('amount')}</Label>
              <Input id="exp-amount" type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="exp-currency">{t('currency')}</Label>
              <Input id="exp-currency" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="exp-description">{t('description')}</Label>
            <Textarea id="exp-description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          {documentOptions.length > 0 && (
            <div className="space-y-1">
              <Label>{t('linkedDocument')}</Label>
              <Select value={documentId ?? '__none'} onValueChange={(v) => setDocumentId(v === '__none' ? undefined : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">{t('noLinkedDocument')}</SelectItem>
                  {documentOptions.map((d) => <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={createExpense.isPending}>{t('create')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExpensesPanel({ customerOrderId, canManage }: { customerOrderId: string; canManage: boolean }) {
  const t = useTranslations('finance');
  const tc = useTranslations('common');
  const { data: expenses } = useCustomerOrderFinanceExpenses(customerOrderId);
  const { data: documents } = useCustomerOrderFinanceDocuments(customerOrderId);
  const deleteExpense = useDeleteCustomerOrderExpense(customerOrderId);

  const documentOptions = (documents ?? []).map((d) => ({ id: d.id, label: d.documentNumber || t(`documentType${d.documentType}`) }));
  const documentLabelById = new Map(documentOptions.map((d) => [d.id, d.label]));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{t('directExpenses')}</CardTitle>
        {canManage && <NewExpenseDialog customerOrderId={customerOrderId} documentOptions={documentOptions} />}
      </CardHeader>
      <CardContent className="space-y-2">
        {(expenses?.length ?? 0) === 0 && <p className="text-sm text-muted-foreground">{t('noExpenses')}</p>}
        {expenses?.map((exp) => (
          <div key={exp.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
            <div>
              <div className="font-medium">{t(`expenseCategory${exp.category}`)}</div>
              <div className="text-xs text-muted-foreground">
                {exp.description}
                {exp.documentId && ` · ${documentLabelById.get(exp.documentId) ?? t('linkedDocument')}`}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span>{formatMoney(Number(exp.amount), exp.currency)}</span>
              {canManage && (
                <button type="button" className="text-xs text-destructive hover:underline" onClick={() => deleteExpense.mutate(exp.id)}>
                  {tc('delete')}
                </button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function CustomerOrderFinancePage() {
  const params = useParams<{ customerOrderId: string }>();
  const customerOrderId = params.customerOrderId;
  const { data: order, isLoading } = useCustomerOrder(customerOrderId);
  const canManage = useHasPermission('finance:manage');

  if (isLoading) return <LoadingBlock />;
  if (!order) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{order.orderNumber || order.clientName}</h1>
        <p className="text-sm text-muted-foreground">{order.clientName}</p>
      </div>
      <SummaryCard customerOrderId={customerOrderId} />
      <LinkedPurchaseOrdersPanel customerOrderId={customerOrderId} />
      <DocumentsPanel customerOrderId={customerOrderId} canManage={canManage} />
      <ExpensesPanel customerOrderId={customerOrderId} canManage={canManage} />
    </div>
  );
}
