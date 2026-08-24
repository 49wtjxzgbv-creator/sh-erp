'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  useFinanceDocument,
  useAddFinancePayment,
  useUpdateFinancePayment,
  useDeleteFinancePayment,
  useDeleteFinanceDocument,
  useCustomerOrderFinanceDocument,
  useAddCustomerOrderPayment,
  useUpdateCustomerOrderPayment,
  useDeleteCustomerOrderPayment,
  useDeleteCustomerOrderDocument,
} from '@/lib/hooks/use-finance';
import type { PurchaseOrderPayment } from '@/lib/api-client/finance';
import { useFilesForEntity, useFileDownloadUrl } from '@/lib/hooks/use-files';
import { uploadFile } from '@/lib/api-client/files';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { formatMoney } from '@/lib/finance-format';
import type { DocumentPaymentStatus } from '@/lib/api-client/finance';
import { DocumentEditForm, type FinanceKind } from './document-form';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/** Which parent this document/drawer belongs to — the only thing that differs between the PurchaseOrder-Finance and CustomerOrder-Finance flavors of this drawer is which hooks/file-entityType to use; the UI is otherwise identical. */
type DocumentDrawerKind = FinanceKind;

const DOCUMENT_STATUS_VARIANT: Record<DocumentPaymentStatus, 'secondary' | 'warning' | 'success' | 'outline'> = {
  NO_AMOUNT: 'outline',
  UNPAID: 'secondary',
  PARTIAL: 'warning',
  PAID: 'success',
};

const FILE_ENTITY_TYPE: Record<DocumentDrawerKind, string> = {
  'purchase-order': 'PurchaseOrderDocument',
  'customer-order': 'CustomerOrderDocument',
};

/** In-app preview without a mandatory download (point 9 of the confirmed design): PDF renders via a plain `<iframe>` (browsers do this natively, no library), images via `<img>` (same convention as photo-lightbox.tsx), anything else falls back to a filename + explicit download link. */
function DocumentFilePreview({ kind, documentId, canManage }: { kind: DocumentDrawerKind; documentId: string; canManage: boolean }) {
  const t = useTranslations('finance');
  const entityType = FILE_ENTITY_TYPE[kind];
  const { data: files, refetch } = useFilesForEntity(entityType, documentId, 'FINANCE_DOCUMENT');
  const file = files?.[0];
  const { data: downloadUrl } = useFileDownloadUrl(file?.id);
  const [uploading, setUploading] = useState(false);

  async function handleSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setUploading(true);
    try {
      await uploadFile(f, { domain: 'FINANCE_DOCUMENT', entityType, entityId: documentId });
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

function AddPaymentForm({
  kind,
  ownerId,
  documentId,
  remaining,
  currency,
}: {
  kind: DocumentDrawerKind;
  ownerId: string;
  documentId: string;
  remaining: number;
  currency: string;
}) {
  const t = useTranslations('finance');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const addPoPayment = useAddFinancePayment(ownerId, documentId);
  const addCoPayment = useAddCustomerOrderPayment(ownerId, documentId);
  const addPayment = kind === 'purchase-order' ? addPoPayment : addCoPayment;
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

function EditPaymentForm({
  kind,
  ownerId,
  documentId,
  payment,
  onDone,
}: {
  kind: DocumentDrawerKind;
  ownerId: string;
  documentId: string;
  payment: PurchaseOrderPayment;
  onDone: () => void;
}) {
  const t = useTranslations('finance');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const updatePoPayment = useUpdateFinancePayment(ownerId, documentId);
  const updateCoPayment = useUpdateCustomerOrderPayment(ownerId, documentId);
  const updatePayment = kind === 'purchase-order' ? updatePoPayment : updateCoPayment;
  const [amount, setAmount] = useState(String(payment.amount));
  const [paidAt, setPaidAt] = useState(payment.paidAt.slice(0, 10));
  const [method, setMethod] = useState(payment.method ?? '');
  const [note, setNote] = useState(payment.note ?? '');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    const value = Number(amount);
    if (!value || value <= 0) {
      setError(t('amount'));
      return;
    }
    try {
      await updatePayment.mutateAsync({ id: payment.id, dto: { amount: value, paidAt, method: method || undefined, note: note || undefined } });
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="edit-pay-amount">{t('amount')}</Label>
          <Input id="edit-pay-amount" type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="edit-pay-date">{t('paymentDate')}</Label>
          <Input id="edit-pay-date" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="edit-pay-method">{t('paymentMethod')}</Label>
        <Input id="edit-pay-method" value={method} onChange={(e) => setMethod(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="edit-pay-note">{t('note')}</Label>
        <Input id="edit-pay-note" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSubmit} disabled={updatePayment.isPending}>
          {t('save')}
        </Button>
        <Button size="sm" variant="outline" onClick={onDone}>
          {t('cancel')}
        </Button>
      </div>
    </div>
  );
}

export function DocumentDrawer({
  kind = 'purchase-order',
  ownerId,
  documentId,
  open,
  onOpenChange,
  canManage,
}: {
  /** Defaults to 'purchase-order' so every existing call site (PO-Finance detail page) keeps working unchanged. */
  kind?: DocumentDrawerKind;
  /** The owning PurchaseOrder or CustomerOrder id (matches `kind`). */
  ownerId: string;
  documentId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
}) {
  const t = useTranslations('finance');
  const tc = useTranslations('common');

  const poDocument = useFinanceDocument(kind === 'purchase-order' ? documentId : undefined);
  const coDocument = useCustomerOrderFinanceDocument(kind === 'customer-order' ? documentId : undefined);
  const document = kind === 'purchase-order' ? poDocument.data : coDocument.data;

  const deletePoDocument = useDeleteFinanceDocument(ownerId);
  const deleteCoDocument = useDeleteCustomerOrderDocument(ownerId);
  const deletePoPayment = useDeleteFinancePayment(ownerId, documentId ?? '');
  const deleteCoPayment = useDeleteCustomerOrderPayment(ownerId, documentId ?? '');
  const deleteDocument = kind === 'purchase-order' ? deletePoDocument : deleteCoDocument;
  const deletePayment = kind === 'purchase-order' ? deletePoPayment : deleteCoPayment;

  const [editingPaymentId, setEditingPaymentId] = useState<string | undefined>();
  const [editingDocument, setEditingDocument] = useState(false);

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
              <DocumentFilePreview kind={kind} documentId={document.id} canManage={canManage} />

              <div className="space-y-4">
                {editingDocument ? (
                  <DocumentEditForm
                    kind={kind}
                    ownerId={ownerId}
                    document={document}
                    onSaved={() => setEditingDocument(false)}
                    onCancel={() => setEditingDocument(false)}
                  />
                ) : (
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
                    {canManage && (
                      <div className="pt-2">
                        <Button size="sm" variant="outline" onClick={() => setEditingDocument(true)}>
                          {t('editDocument')}
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium">{t('payments')}</h3>
                    {document.amount !== null && (
                      <span className="text-xs text-muted-foreground">{t('remainingBalance')}: {formatMoney(remaining, document.currency)}</span>
                    )}
                  </div>
                  {document.payments.length === 0 && <p className="text-sm text-muted-foreground">{t('noPayments')}</p>}
                  <ul className="space-y-1">
                    {document.payments.map((p) =>
                      editingPaymentId === p.id ? (
                        <li key={p.id}>
                          <EditPaymentForm kind={kind} ownerId={ownerId} documentId={document.id} payment={p} onDone={() => setEditingPaymentId(undefined)} />
                        </li>
                      ) : (
                        <li key={p.id} className="flex items-center justify-between rounded-md border px-2 py-1 text-sm">
                          <span>
                            {formatMoney(Number(p.amount), p.currency)} — {new Date(p.paidAt).toLocaleDateString()}
                            {p.currency !== document.currency && <span className="ml-1 text-warning">({t('currencyMismatchWarning')})</span>}
                          </span>
                          {canManage && (
                            <span className="flex gap-2">
                              <button
                                type="button"
                                className="text-xs text-primary hover:underline"
                                onClick={() => setEditingPaymentId(p.id)}
                              >
                                {tc('edit')}
                              </button>
                              <button
                                type="button"
                                className="text-xs text-destructive hover:underline"
                                onClick={() => deletePayment.mutate(p.id)}
                              >
                                {tc('delete')}
                              </button>
                            </span>
                          )}
                        </li>
                      ),
                    )}
                  </ul>

                  {canManage && document.amount !== null && (
                    <AddPaymentForm kind={kind} ownerId={ownerId} documentId={document.id} remaining={remaining} currency={document.currency} />
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
