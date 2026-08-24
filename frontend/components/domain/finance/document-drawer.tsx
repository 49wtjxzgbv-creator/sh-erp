'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useFinanceDocument, useAddFinancePayment, useDeleteFinancePayment, useDeleteFinanceDocument } from '@/lib/hooks/use-finance';
import { useFilesForEntity, useFileDownloadUrl } from '@/lib/hooks/use-files';
import { uploadFile } from '@/lib/api-client/files';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { formatMoney } from '@/lib/finance-format';
import type { DocumentPaymentStatus } from '@/lib/api-client/finance';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const DOCUMENT_STATUS_VARIANT: Record<DocumentPaymentStatus, 'secondary' | 'warning' | 'success' | 'outline'> = {
  NO_AMOUNT: 'outline',
  UNPAID: 'secondary',
  PARTIAL: 'warning',
  PAID: 'success',
};

/** In-app preview without a mandatory download (point 9 of the confirmed design): PDF renders via a plain `<iframe>` (browsers do this natively, no library), images via `<img>` (same convention as photo-lightbox.tsx), anything else falls back to a filename + explicit download link. */
function DocumentFilePreview({ documentId, canManage }: { documentId: string; canManage: boolean }) {
  const t = useTranslations('finance');
  const { data: files, refetch } = useFilesForEntity('PurchaseOrderDocument', documentId, 'FINANCE_DOCUMENT');
  const file = files?.[0];
  const { data: downloadUrl } = useFileDownloadUrl(file?.id);
  const [uploading, setUploading] = useState(false);

  async function handleSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setUploading(true);
    try {
      await uploadFile(f, { domain: 'FINANCE_DOCUMENT', entityType: 'PurchaseOrderDocument', entityId: documentId });
      await refetch();
    } finally {
      setUploading(false);
    }
  }

  if (!file) {
    return (
      <div className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-3 rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        <span>{t('noFileYet')}</span>
        {canManage && <input type="file" onChange={handleSelect} disabled={uploading} className="text-sm" />}
      </div>
    );
  }

  if (file.mimeType === 'application/pdf') {
    return downloadUrl ? (
      <iframe src={downloadUrl} title={file.originalName} className="h-full min-h-[24rem] w-full rounded-md border" />
    ) : (
      <div className="flex h-full min-h-[16rem] items-center justify-center text-sm text-muted-foreground">…</div>
    );
  }

  if (file.mimeType.startsWith('image/')) {
    return downloadUrl ? (
      // eslint-disable-next-line @next/next/no-img-element -- arbitrary presigned R2 URL, same convention as photo-lightbox.tsx
      <img src={downloadUrl} alt={file.originalName} className="max-h-[28rem] w-full rounded-md border object-contain" />
    ) : (
      <div className="flex h-full min-h-[16rem] items-center justify-center text-sm text-muted-foreground">…</div>
    );
  }

  return (
    <div className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-2 rounded-md border p-8 text-center text-sm">
      <span className="font-medium">{file.originalName}</span>
      <span className="text-muted-foreground">{t('noFilePreview')}</span>
      {downloadUrl && (
        <a href={downloadUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
          {t('download')}
        </a>
      )}
      {canManage && (
        <div className="pt-2">
          <input type="file" onChange={handleSelect} disabled={uploading} className="text-sm" />
        </div>
      )}
    </div>
  );
}

function AddPaymentForm({ purchaseOrderId, documentId, remaining, currency }: { purchaseOrderId: string; documentId: string; remaining: number; currency: string }) {
  const t = useTranslations('finance');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const addPayment = useAddFinancePayment(purchaseOrderId, documentId);
  const [amount, setAmount] = useState(remaining > 0 ? String(remaining) : '');
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    const value = Number(amount);
    if (!value || value <= 0) {
      setError(t('amount'));
      return;
    }
    try {
      await addPayment.mutateAsync({ amount: value, currency, paidAt, method: method || undefined, note: note || undefined });
      setAmount('');
      setMethod('');
      setNote('');
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="pay-amount">{t('amount')}</Label>
          <Input id="pay-amount" type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pay-date">{t('paymentDate')}</Label>
          <Input id="pay-date" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="pay-method">{t('paymentMethod')}</Label>
        <Input id="pay-method" value={method} onChange={(e) => setMethod(e.target.value)} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button size="sm" onClick={handleSubmit} disabled={addPayment.isPending}>
        {t('addPayment')}
      </Button>
    </div>
  );
}

export function DocumentDrawer({
  purchaseOrderId,
  documentId,
  open,
  onOpenChange,
  canManage,
}: {
  purchaseOrderId: string;
  documentId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
}) {
  const t = useTranslations('finance');
  const tc = useTranslations('common');
  const { data: document } = useFinanceDocument(documentId);
  const deleteDocument = useDeleteFinanceDocument(purchaseOrderId);
  const deletePayment = useDeleteFinancePayment(purchaseOrderId, documentId ?? '');

  if (!documentId) return null;

  const paidSameCurrency = document
    ? document.payments.filter((p) => p.currency === document.currency).reduce((sum, p) => sum + Number(p.amount), 0)
    : 0;
  const remaining = document?.amount ? Math.max(Number(document.amount) - paidSameCurrency, 0) : 0;

  async function handleDelete() {
    if (!documentId) return;
    if (!window.confirm(t('confirmDelete'))) return;
    await deleteDocument.mutateAsync(documentId);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="full" className="max-h-[90vh] overflow-y-auto">
        {document && (
          <>
            <DialogHeader>
              <DialogTitle>
                {document.documentNumber || t(`documentType${document.documentType}`)} · {document.counterparty?.name}
              </DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-1 gap-6 pt-2 lg:grid-cols-2">
              <DocumentFilePreview documentId={document.id} canManage={canManage} />

              <div className="space-y-4">
                {/* TODO (P2, deferred at pre-production audit 2026-08-24 point 9):
                    metadata below is read-only in this drawer. PATCH
                    /finance/documents/:id already exists and is tested
                    (finance.service.spec.ts) — only the edit FORM is
                    missing here. Not required for MVP acceptance criteria;
                    add a small inline-edit affordance per field (or a
                    single "edit" mode toggle) when prioritized. */}
                <div className="space-y-1 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t('documentType')}</span>
                    <span>{t(`documentType${document.documentType}`)}</span>
                  </div>
                  {document.documentNumber && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">{t('documentNumber')}</span>
                      <span>{document.documentNumber}</span>
                    </div>
                  )}
                  {document.documentDate && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">{t('documentDate')}</span>
                      <span>{new Date(document.documentDate).toLocaleDateString()}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t('counterparty')}</span>
                    <span>{document.counterparty?.name}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t('amount')}</span>
                    <span className="font-medium">{document.amount ? formatMoney(Number(document.amount), document.currency) : '—'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t('status')}</span>
                    <Badge variant={DOCUMENT_STATUS_VARIANT[document.paymentStatus]}>
                      {document.paymentStatus === 'NO_AMOUNT' ? t('documentPaymentStatusNO_AMOUNT') : t(`paymentStatus${document.paymentStatus}`)}
                    </Badge>
                  </div>
                  {document.note && (
                    <div className="pt-1">
                      <span className="text-muted-foreground">{t('note')}: </span>
                      <span>{document.note}</span>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium">{t('payments')}</h3>
                    {document.amount !== null && (
                      <span className="text-xs text-muted-foreground">{t('remainingBalance')}: {formatMoney(remaining, document.currency)}</span>
                    )}
                  </div>
                  {document.payments.length === 0 && <p className="text-sm text-muted-foreground">{t('noPayments')}</p>}
                  <ul className="space-y-1">
                    {document.payments.map((p) => (
                      <li key={p.id} className="flex items-center justify-between rounded-md border px-2 py-1 text-sm">
                        <span>
                          {formatMoney(Number(p.amount), p.currency)} — {new Date(p.paidAt).toLocaleDateString()}
                          {p.currency !== document.currency && <span className="ml-1 text-warning">({t('currencyMismatchWarning')})</span>}
                        </span>
                        {canManage && (
                          <button
                            type="button"
                            className="text-xs text-destructive hover:underline"
                            onClick={() => deletePayment.mutate(p.id)}
                          >
                            {tc('delete')}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>

                  {canManage && document.amount !== null && (
                    <AddPaymentForm purchaseOrderId={purchaseOrderId} documentId={document.id} remaining={remaining} currency={document.currency} />
                  )}
                  {canManage && document.amount === null && (
                    <p className="text-sm text-muted-foreground">{t('cannotPayNoAmount')}</p>
                  )}
                </div>

                {canManage && (
                  <Button variant="destructive" size="sm" onClick={handleDelete}>
                    {tc('delete')}
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
