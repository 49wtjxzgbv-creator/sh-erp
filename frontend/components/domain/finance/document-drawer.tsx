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
import { useFilesForEntity, useFileDownloadUrl, useFilePreview, useDeleteFile } from '@/lib/hooks/use-files';
import { uploadFile, type FileAsset } from '@/lib/api-client/files';
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

const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Server-side parsed table preview for a .xlsx attachment — see files.service.ts#getSpreadsheetPreview's header comment for why this is the one file type proxied through the API instead of previewed via a plain `<iframe>`/`<img>` src. */
function SpreadsheetPreview({ fileId, fileName, downloadUrl }: { fileId: string; fileName: string; downloadUrl: string | undefined }) {
  const t = useTranslations('finance');
  const apiErrorMessage = useApiErrorMessage();
  const { data: preview, isLoading, error } = useFilePreview(fileId, true);
  const [activeSheet, setActiveSheet] = useState(0);

  if (isLoading) {
    return <div className="flex h-full min-h-[16rem] items-center justify-center text-sm text-muted-foreground">…</div>;
  }

  if (error || !preview || preview.sheets.length === 0) {
    return (
      <div className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-2 rounded-md border p-8 text-center text-sm">
        <span className="font-medium">{fileName}</span>
        <span className="text-muted-foreground">{error ? apiErrorMessage(error, t('noFilePreview')) : t('noFilePreview')}</span>
        {downloadUrl && (
          <a href={downloadUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            {t('download')}
          </a>
        )}
      </div>
    );
  }

  const sheet = preview.sheets[Math.min(activeSheet, preview.sheets.length - 1)];

  return (
    <div className="flex h-full min-h-[16rem] flex-col gap-2 rounded-md border p-2">
      {preview.sheets.length > 1 && (
        <div className="flex flex-wrap gap-1 border-b pb-2">
          {preview.sheets.map((s, i) => (
            <button
              key={s.name}
              type="button"
              onClick={() => setActiveSheet(i)}
              className={`rounded px-2 py-1 text-xs ${i === activeSheet ? 'bg-secondary font-medium' : 'text-muted-foreground hover:underline'}`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="max-h-[28rem] overflow-auto">
        <table className="min-w-full border-collapse text-xs">
          <tbody>
            {sheet.rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci} className="border px-2 py-1 whitespace-nowrap">{cell ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(sheet.truncatedRows || sheet.truncatedCols || preview.truncatedSheets) && (
        <p className="text-xs text-muted-foreground">{t('previewTruncated')}</p>
      )}
      {downloadUrl && (
        <a href={downloadUrl} target="_blank" rel="noopener noreferrer" className="self-start text-xs text-primary hover:underline">
          {t('download')}
        </a>
      )}
    </div>
  );
}

/** Opens the file in a new tab and asks it to print itself once loaded — works for anything the browser renders natively (PDF, images); `window.print()` is one of the handful of Window members exposed cross-origin, so this is safe even though a presigned R2 URL is a different origin. */
function printFileUrl(url: string) {
  const win = window.open(url, '_blank');
  if (!win) return;
  win.addEventListener('load', () => {
    win.focus();
    win.print();
  });
}

/** Download + Print action row for a file the browser can render inline (PDF/image) — `canPrint` is false for anything else (e.g. the unsupported-type fallback), since "print" only makes sense once there's something on-screen to print. */
function FileActions({ downloadUrl, canPrint }: { downloadUrl: string | undefined; canPrint: boolean }) {
  const t = useTranslations('finance');
  if (!downloadUrl) return null;
  return (
    <div className="flex gap-3 pt-1 text-xs">
      <a href={downloadUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
        {t('download')}
      </a>
      {canPrint && (
        <button type="button" className="text-primary hover:underline" onClick={() => printFileUrl(downloadUrl)}>
          {t('print')}
        </button>
      )}
    </div>
  );
}

/** One selected file's preview, branched by mimeType — PDF via `<iframe>` (browsers do this natively, no library), images via `<img>` (same convention as photo-lightbox.tsx), .xlsx via SpreadsheetPreview (server-parsed table, own download-only row — printing a raw workbook isn't meaningful the same way), anything else falls back to a filename + Download only. */
function FileContentPreview({ file, downloadUrl }: { file: FileAsset; downloadUrl: string | undefined }) {
  const t = useTranslations('finance');

  if (file.mimeType === 'application/pdf') {
    return downloadUrl ? (
      <div className="flex h-full min-h-[24rem] flex-col gap-1">
        <iframe src={downloadUrl} title={file.originalName} className="min-h-[24rem] w-full flex-1 rounded-md border" />
        <FileActions downloadUrl={downloadUrl} canPrint />
      </div>
    ) : (
      <div className="flex h-full min-h-[16rem] items-center justify-center text-sm text-muted-foreground">…</div>
    );
  }

  if (file.mimeType.startsWith('image/')) {
    return downloadUrl ? (
      <div className="flex h-full flex-col gap-1">
        {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary presigned R2 URL, same convention as photo-lightbox.tsx */}
        <img src={downloadUrl} alt={file.originalName} className="max-h-[28rem] w-full rounded-md border object-contain" />
        <FileActions downloadUrl={downloadUrl} canPrint />
      </div>
    ) : (
      <div className="flex h-full min-h-[16rem] items-center justify-center text-sm text-muted-foreground">…</div>
    );
  }

  if (file.mimeType === XLSX_MIME_TYPE) {
    return <SpreadsheetPreview fileId={file.id} fileName={file.originalName} downloadUrl={downloadUrl} />;
  }

  return (
    <div className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-2 rounded-md border p-8 text-center text-sm">
      <span className="font-medium">{file.originalName}</span>
      <span className="text-muted-foreground">{t('noFilePreview')}</span>
      <FileActions downloadUrl={downloadUrl} canPrint={false} />
    </div>
  );
}

/** In-app preview for every file attached to this document — a document can carry more than one (multi-file upload/attach), so this owns a tab strip to pick which one is shown, on top of FileContentPreview's per-file rendering. */
function DocumentFilePreview({ kind, documentId, canManage }: { kind: DocumentDrawerKind; documentId: string; canManage: boolean }) {
  const t = useTranslations('finance');
  const tc = useTranslations('common');
  const entityType = FILE_ENTITY_TYPE[kind];
  const { data: files, refetch } = useFilesForEntity(entityType, documentId, 'FINANCE_DOCUMENT');
  const deleteFile = useDeleteFile();
  const [selectedFileId, setSelectedFileId] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);

  const fileList = files ?? [];
  const activeFile = fileList.find((f) => f.id === selectedFileId) ?? fileList[0];
  const { data: downloadUrl } = useFileDownloadUrl(activeFile?.id);

  async function handleSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (selected.length === 0) return;
    setUploading(true);
    try {
      for (const f of selected) {
        await uploadFile(f, { domain: 'FINANCE_DOCUMENT', entityType, entityId: documentId });
      }
      await refetch();
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteFile(fileId: string) {
    if (!window.confirm(t('confirmDelete'))) return;
    await deleteFile.mutateAsync(fileId);
    if (selectedFileId === fileId) setSelectedFileId(undefined);
    await refetch();
  }

  if (fileList.length === 0) {
    return (
      <div className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-3 rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        <span>{t('noFileYet')}</span>
        {canManage && <input type="file" multiple onChange={handleSelect} disabled={uploading} className="text-sm" />}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[16rem] flex-col gap-2">
      {fileList.length > 1 && (
        <div className="flex flex-wrap gap-1 border-b pb-2">
          {fileList.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setSelectedFileId(f.id)}
              title={f.originalName}
              className={`max-w-[10rem] truncate rounded px-2 py-1 text-xs ${
                (activeFile?.id ?? fileList[0].id) === f.id ? 'bg-secondary font-medium' : 'text-muted-foreground hover:underline'
              }`}
            >
              {f.originalName}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1">{activeFile && <FileContentPreview file={activeFile} downloadUrl={downloadUrl} />}</div>
      {canManage && (
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <input type="file" multiple onChange={handleSelect} disabled={uploading} className="text-sm" />
          {activeFile && (
            <button type="button" className="text-xs text-destructive hover:underline" onClick={() => handleDeleteFile(activeFile.id)}>
              {tc('delete')} «{activeFile.originalName}»
            </button>
          )}
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
