'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingBlock } from '@/components/ui/loading-block';
import { supplierPortalApi } from '@/lib/supplier-portal/api';
import { useApiErrorMessage } from '@/lib/api-error-message';
import type { FileAsset } from '@/lib/api-client/files';

type InvoicePaymentStatus = 'NO_AMOUNT' | 'UNPAID' | 'PARTIAL' | 'PAID';

interface PortalInvoicePayment {
  id: string;
  amount: string;
  currency: string;
  paidAt: string;
  method: string | null;
  note: string | null;
}

interface PortalInvoiceDetail {
  id: string;
  documentNumber: string | null;
  documentDate: string | null;
  amount: string | null;
  currency: string;
  note: string | null;
  paymentStatus: InvoicePaymentStatus;
  payments: PortalInvoicePayment[];
  purchaseOrder: { id: string; orderDate: string };
}

const STATUS_VARIANT: Record<InvoicePaymentStatus, 'secondary' | 'warning' | 'success' | 'outline'> = {
  NO_AMOUNT: 'outline',
  UNPAID: 'secondary',
  PARTIAL: 'warning',
  PAID: 'success',
};

/** Same 3-step presign→PUT→confirm shape as orders/[id]'s SupplierPortalDocumentsPanel, just pointed at finance-documents/:id/files (domain FINANCE_DOCUMENT) instead of purchase-orders/:id/files (domain PURCHASE_INVOICE). */
function InvoiceFilesPanel({ documentId }: { documentId: string }) {
  const t = useTranslations('supplierPortal');
  const apiErrorMessage = useApiErrorMessage();
  const [files, setFiles] = useState<FileAsset[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await supplierPortalApi.get<FileAsset[]>(`supplier-portal/finance-documents/${documentId}/files`);
    setFiles(res);
  }, [documentId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const presigned = await supplierPortalApi.post<{ fileAssetId: string; uploadUrl: string }>(
        `supplier-portal/finance-documents/${documentId}/files/presigned-upload`,
        { originalName: file.name, mimeType: file.type || 'application/octet-stream', sizeBytes: file.size },
      );
      const putRes = await fetch(presigned.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!putRes.ok) throw new Error(`Upload to storage failed (${putRes.status}).`);
      await supplierPortalApi.post(`supplier-portal/finance-documents/${documentId}/files/${presigned.fileAssetId}/confirm`);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, t('scheduleActionFailed')));
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(fileAssetId: string) {
    const { downloadUrl } = await supplierPortalApi.get<{ downloadUrl: string }>(
      `supplier-portal/finance-documents/${documentId}/files/${fileAssetId}/download-url`,
    );
    window.open(downloadUrl, '_blank', 'noopener,noreferrer');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('documents')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {files.length === 0 && <p className="text-sm text-muted-foreground">{t('noDocuments')}</p>}
        <ul className="space-y-1">
          {files.map((f) => (
            <li key={f.id}>
              <button type="button" className="text-sm text-primary hover:underline" onClick={() => handleDownload(f.id)}>
                {f.originalName}
              </button>
            </li>
          ))}
        </ul>
        <div className="space-y-1.5">
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.docx" onChange={handleFileSelected} disabled={uploading} className="text-sm" />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function SupplierPortalFinanceDocumentPage() {
  const params = useParams<{ id: string }>();
  const t = useTranslations('supplierPortal');
  const tc = useTranslations('common');
  const router = useRouter();
  const apiErrorMessage = useApiErrorMessage();

  const [invoice, setInvoice] = useState<PortalInvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payMethod, setPayMethod] = useState('');
  const [payNote, setPayNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await supplierPortalApi.get<PortalInvoiceDetail>(`supplier-portal/finance-documents/${params.id}`);
      setInvoice(res);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAddPayment() {
    setError(null);
    const value = Number(payAmount);
    if (!value || value <= 0) {
      setError(t('invoiceAmountLabel'));
      return;
    }
    setSubmitting(true);
    try {
      await supplierPortalApi.post(`supplier-portal/finance-documents/${params.id}/payments`, {
        amount: value,
        paidAt: payDate,
        method: payMethod || undefined,
        note: payNote || undefined,
      });
      setPayAmount('');
      setPayMethod('');
      setPayNote('');
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingBlock />;
  if (notFound || !invoice) return <p className="text-sm text-muted-foreground">{t('financeInvoiceNotFound')}</p>;

  const paidSum = invoice.payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const remaining = invoice.amount ? Math.max(Number(invoice.amount) - paidSum, 0) : 0;

  return (
    <div className="max-w-3xl space-y-4">
      <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={() => router.push('/supplier-portal/finance')}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        {t('navFinance')}
      </Button>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">{invoice.documentNumber || t('navFinance')}</CardTitle>
          <Badge variant={STATUS_VARIANT[invoice.paymentStatus]}>
            {invoice.paymentStatus === 'NO_AMOUNT' ? t('financeStatusNO_AMOUNT') : t(`financeStatus${invoice.paymentStatus}`)}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t('orderDate')}</span>
            <span>{new Date(invoice.purchaseOrder.orderDate).toLocaleDateString()}</span>
          </div>
          {invoice.documentDate && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('invoiceDateLabel')}</span>
              <span>{new Date(invoice.documentDate).toLocaleDateString()}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t('invoiceAmountLabel')}</span>
            <span className="font-medium">{invoice.amount ? `${invoice.amount} ${invoice.currency}` : '—'}</span>
          </div>
          {invoice.note && (
            <div className="pt-1">
              <span className="text-muted-foreground">{t('invoiceNoteLabel')}: </span>
              <span>{invoice.note}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <InvoiceFilesPanel documentId={invoice.id} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">{t('financePaymentsTitle')}</CardTitle>
          {invoice.amount && (
            <span className="text-xs text-muted-foreground">
              {t('financeRemainingBalance')}: {remaining} {invoice.currency}
            </span>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {invoice.payments.length === 0 && <p className="text-sm text-muted-foreground">{t('financeNoPayments')}</p>}
          <ul className="space-y-1">
            {invoice.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded-md border px-2 py-1 text-sm">
                <span>
                  {p.amount} {p.currency} — {new Date(p.paidAt).toLocaleDateString()}
                  {p.method && <span className="ml-1 text-muted-foreground">({p.method})</span>}
                </span>
              </li>
            ))}
          </ul>

          {invoice.amount ? (
            <div className="space-y-2 rounded-md border p-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="pay-amount">{t('invoiceAmountLabel')}</Label>
                  <Input id="pay-amount" type="number" step="0.01" min="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pay-date">{t('financePaymentDateLabel')}</Label>
                  <Input id="pay-date" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="pay-method">{t('financePaymentMethodLabel')}</Label>
                <Input id="pay-method" value={payMethod} onChange={(e) => setPayMethod(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pay-note">{t('invoiceNoteLabel')}</Label>
                <Input id="pay-note" value={payNote} onChange={(e) => setPayNote(e.target.value)} />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="button" size="sm" loading={submitting} onClick={handleAddPayment}>
                {t('financeAddPaymentButton')}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('financeCannotPayNoAmount')}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
