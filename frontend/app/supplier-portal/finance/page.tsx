'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingBlock } from '@/components/ui/loading-block';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supplierPortalApi } from '@/lib/supplier-portal/api';
import { useApiErrorMessage } from '@/lib/api-error-message';
import type { PurchaseOrderStatus } from '@/lib/api-client/procurement';

type InvoicePaymentStatus = 'NO_AMOUNT' | 'UNPAID' | 'PARTIAL' | 'PAID';

interface PortalInvoiceRow {
  id: string;
  documentNumber: string | null;
  documentDate: string | null;
  amount: string | null;
  currency: string;
  paymentStatus: InvoicePaymentStatus;
  /** Null — "рахунок не обов'язково може бути прив'язаний до замовлення" (2026-11-06). */
  purchaseOrder: { id: string; orderDate: string; status: PurchaseOrderStatus } | null;
}

/** Radix Select forbids an empty-string item value, so "no order" needs a real sentinel instead of undefined/''. */
const NO_ORDER = '__none__';

interface PortalOrderOption {
  id: string;
  orderDate: string;
  status: PurchaseOrderStatus;
}

const STATUS_VARIANT: Record<InvoicePaymentStatus, 'secondary' | 'warning' | 'success' | 'outline'> = {
  NO_AMOUNT: 'outline',
  UNPAID: 'secondary',
  PARTIAL: 'warning',
  PAID: 'success',
};

/**
 * "Фінанси" (2026-11-05) — "додай можливість завантажувати рахунки, ті
 * рахунки також відображалися у виробника, також можливість вказувати чи
 * він оплочений чи частково оплочений і яка сума". Reuses the exact same
 * PurchaseOrderDocument/PurchaseOrderPayment rows the staff Finance module
 * already manages (see FinanceService#createDocumentAsSupplier) — an
 * invoice uploaded here shows up on the manufacturer's own
 * /finance/purchase-orders/:id page with zero extra staff-side work.
 */
export default function SupplierPortalFinancePage() {
  const t = useTranslations('supplierPortal');
  const tc = useTranslations('common');
  const router = useRouter();
  const apiErrorMessage = useApiErrorMessage();

  const [invoices, setInvoices] = useState<PortalInvoiceRow[]>([]);
  const [orders, setOrders] = useState<PortalOrderOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [orderId, setOrderId] = useState<string>(NO_ORDER);
  const [documentNumber, setDocumentNumber] = useState('');
  const [documentDate, setDocumentDate] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [invoicesRes, ordersRes] = await Promise.all([
        supplierPortalApi.get<{ items: PortalInvoiceRow[] }>('supplier-portal/finance-documents'),
        supplierPortalApi.get<{ items: PortalOrderOption[] }>('supplier-portal/purchase-orders'),
      ]);
      setInvoices(invoicesRes.items);
      setOrders(ordersRes.items);
    } catch {
      setInvoices([]);
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit() {
    setError(null);
    const value = Number(amount);
    if (!value || value <= 0) {
      setError(t('invoiceAmountLabel'));
      return;
    }
    setSubmitting(true);
    try {
      await supplierPortalApi.post('supplier-portal/finance-documents', {
        purchaseOrderId: orderId === NO_ORDER ? undefined : orderId,
        documentNumber: documentNumber || undefined,
        documentDate: documentDate || undefined,
        amount: value,
        currency,
        note: note || undefined,
      });
      setOrderId(NO_ORDER);
      setDocumentNumber('');
      setDocumentDate('');
      setAmount('');
      setNote('');
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <LoadingBlock />;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t('navFinance')}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('financeUploadTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label>{t('financeOrderLabel')}</Label>
              <Select value={orderId} onValueChange={setOrderId}>
                <SelectTrigger>
                  <SelectValue placeholder={t('financeSelectOrderPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ORDER}>{t('financeNoOrderOption')}</SelectItem>
                  {orders.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {new Date(o.orderDate).toLocaleDateString()} · {t(`status${o.status}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invoice-number">{t('invoiceNumberLabel')}</Label>
              <Input id="invoice-number" value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invoice-date">{t('invoiceDateLabel')}</Label>
              <Input id="invoice-date" type="date" value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invoice-amount">{t('invoiceAmountLabel')}</Label>
              <Input id="invoice-amount" type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invoice-currency">{t('invoiceCurrencyLabel')}</Label>
              <Input id="invoice-currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} />
            </div>
            <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
              <Label htmlFor="invoice-note">{t('invoiceNoteLabel')}</Label>
              <Input id="invoice-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="button" loading={submitting} onClick={handleSubmit}>
            {t('financeUploadButton')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('financeInvoicesTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('invoiceDateLabel')}</TableHead>
                <TableHead>{t('invoiceNumberLabel')}</TableHead>
                <TableHead>{t('orderDate')}</TableHead>
                <TableHead>{t('invoiceAmountLabel')}</TableHead>
                <TableHead>{t('status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    {t('financeNoInvoices')}
                  </TableCell>
                </TableRow>
              ) : (
                invoices.map((inv) => (
                  <TableRow key={inv.id} className="cursor-pointer" onClick={() => router.push(`/supplier-portal/finance/${inv.id}`)}>
                    <TableCell>{inv.documentDate ? new Date(inv.documentDate).toLocaleDateString() : '—'}</TableCell>
                    <TableCell>{inv.documentNumber || '—'}</TableCell>
                    <TableCell>{inv.purchaseOrder ? new Date(inv.purchaseOrder.orderDate).toLocaleDateString() : '—'}</TableCell>
                    <TableCell>{inv.amount ? `${inv.amount} ${inv.currency}` : '—'}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[inv.paymentStatus]}>
                        {inv.paymentStatus === 'NO_AMOUNT' ? t('financeStatusNO_AMOUNT') : t(`financeStatus${inv.paymentStatus}`)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
