'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useCreateFinanceDocument, useUpdateFinanceDocument, useCreateCustomerOrderDocument, useUpdateCustomerOrderDocument } from '@/lib/hooks/use-finance';
import { useApiErrorMessage } from '@/lib/api-error-message';
import type { PurchaseOrderDocumentType, PurchaseOrderDocument, CustomerOrderDocument } from '@/lib/api-client/finance';
import { SupplierPicker } from '@/components/domain/procurement/supplier-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

/** Which parent this form/panel/drawer belongs to — the only thing that differs between the PurchaseOrder-Finance and CustomerOrder-Finance flavors of the Finance UI is which hooks/entityType to use; everything else is identical. Shared across document-drawer.tsx, documents-panel.tsx, and expenses-panel.tsx. */
export type FinanceKind = 'purchase-order' | 'customer-order';

const DOCUMENT_TYPES: PurchaseOrderDocumentType[] = [
  'INVOICE', 'DELIVERY_NOTE', 'PROFORMA_INVOICE', 'PACKING_LIST', 'TRANSPORT_DOCUMENT', 'CUSTOMS_DOCUMENT', 'ACT', 'OTHER',
];

interface DocumentFieldsState {
  documentType: PurchaseOrderDocumentType;
  setDocumentType: (v: PurchaseOrderDocumentType) => void;
  documentNumber: string;
  setDocumentNumber: (v: string) => void;
  documentDate: string;
  setDocumentDate: (v: string) => void;
  counterpartyId: string | undefined;
  counterpartyLabel: string | undefined;
  setCounterparty: (id: string | undefined, label: string | undefined) => void;
  amount: string;
  setAmount: (v: string) => void;
  currency: string;
  setCurrency: (v: string) => void;
  note: string;
  setNote: (v: string) => void;
  reset: () => void;
}

function useDocumentFieldsState(initial?: PurchaseOrderDocument | CustomerOrderDocument, defaultSupplierId?: string): DocumentFieldsState {
  const [documentType, setDocumentType] = useState<PurchaseOrderDocumentType>(initial?.documentType ?? 'INVOICE');
  const [documentNumber, setDocumentNumber] = useState(initial?.documentNumber ?? '');
  const [documentDate, setDocumentDate] = useState(initial?.documentDate ? initial.documentDate.slice(0, 10) : '');
  const [counterpartyId, setCounterpartyId] = useState<string | undefined>(initial?.counterpartyId ?? defaultSupplierId);
  const [counterpartyLabel, setCounterpartyLabel] = useState<string | undefined>(initial?.counterparty?.name);
  const [amount, setAmount] = useState(initial?.amount != null ? String(initial.amount) : '');
  const [currency, setCurrency] = useState(initial?.currency ?? 'EUR');
  const [note, setNote] = useState(initial?.note ?? '');

  function reset() {
    setDocumentType(initial?.documentType ?? 'INVOICE');
    setDocumentNumber(initial?.documentNumber ?? '');
    setDocumentDate(initial?.documentDate ? initial.documentDate.slice(0, 10) : '');
    setCounterpartyId(initial?.counterpartyId ?? defaultSupplierId);
    setCounterpartyLabel(initial?.counterparty?.name);
    setAmount(initial?.amount != null ? String(initial.amount) : '');
    setCurrency(initial?.currency ?? 'EUR');
    setNote(initial?.note ?? '');
  }

  return {
    documentType, setDocumentType,
    documentNumber, setDocumentNumber,
    documentDate, setDocumentDate,
    counterpartyId, counterpartyLabel, setCounterparty: (id, label) => { setCounterpartyId(id); setCounterpartyLabel(label); },
    amount, setAmount,
    currency, setCurrency,
    note, setNote,
    reset,
  };
}

/** The document field set — shared by the "create" dialog and the "edit" form inline in DocumentDrawer, so the ~40 lines of inputs exist exactly once. */
function DocumentFieldsForm({ fields }: { fields: DocumentFieldsState }) {
  const t = useTranslations('finance');
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>{t('documentType')}</Label>
        <Select value={fields.documentType} onValueChange={(v) => fields.setDocumentType(v as PurchaseOrderDocumentType)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {DOCUMENT_TYPES.map((v) => <SelectItem key={v} value={v}>{t(`documentType${v}`)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="doc-number">{t('documentNumber')}</Label>
          <Input id="doc-number" value={fields.documentNumber} onChange={(e) => fields.setDocumentNumber(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="doc-date">{t('documentDate')}</Label>
          <Input id="doc-date" type="date" value={fields.documentDate} onChange={(e) => fields.setDocumentDate(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1">
        <Label>{t('counterparty')}</Label>
        <SupplierPicker value={fields.counterpartyId} initialLabel={fields.counterpartyLabel} onChange={fields.setCounterparty} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="doc-amount">{t('amount')}</Label>
          <Input id="doc-amount" type="number" step="0.01" min="0.01" value={fields.amount} onChange={(e) => fields.setAmount(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="doc-currency">{t('currency')}</Label>
          <Input id="doc-currency" value={fields.currency} maxLength={3} onChange={(e) => fields.setCurrency(e.target.value.toUpperCase())} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t('amountOptionalHint')}</p>
      <div className="space-y-1">
        <Label htmlFor="doc-note">{t('note')}</Label>
        <Textarea id="doc-note" value={fields.note} onChange={(e) => fields.setNote(e.target.value)} />
      </div>
    </div>
  );
}

/** "Додати документ" dialog — kind-parametrized replacement for the two near-duplicate NewDocumentDialogs that used to live in the PO-Finance and CustomerOrder-Finance pages. */
export function DocumentFormDialog({ kind, ownerId, defaultSupplierId }: { kind: FinanceKind; ownerId: string; defaultSupplierId?: string }) {
  const t = useTranslations('finance');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const createPo = useCreateFinanceDocument(ownerId);
  const createCo = useCreateCustomerOrderDocument(ownerId);
  const createDocument = kind === 'purchase-order' ? createPo : createCo;
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fields = useDocumentFieldsState(undefined, defaultSupplierId);

  async function handleSubmit() {
    setError(null);
    if (!fields.counterpartyId) {
      setError(t('counterparty'));
      return;
    }
    try {
      await createDocument.mutateAsync({
        documentType: fields.documentType,
        documentNumber: fields.documentNumber || undefined,
        documentDate: fields.documentDate || undefined,
        counterpartyId: fields.counterpartyId,
        amount: fields.amount ? Number(fields.amount) : undefined,
        currency: fields.currency,
        note: fields.note || undefined,
      });
      setOpen(false);
      fields.reset();
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { fields.reset(); setError(null); } }}>
      <DialogTrigger asChild>
        <Button size="sm">{t('addDocument')}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('addDocument')}</DialogTitle>
        </DialogHeader>
        <DocumentFieldsForm fields={fields} />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={createDocument.isPending}>{t('create')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Inline edit form (no Dialog wrapper of its own — rendered directly inside DocumentDrawer's existing Dialog). */
export function DocumentEditForm({
  kind,
  ownerId,
  document,
  onSaved,
  onCancel,
}: {
  kind: FinanceKind;
  ownerId: string;
  document: PurchaseOrderDocument | CustomerOrderDocument;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('finance');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const updatePo = useUpdateFinanceDocument(ownerId, document.id);
  const updateCo = useUpdateCustomerOrderDocument(ownerId, document.id);
  const updateDocument = kind === 'purchase-order' ? updatePo : updateCo;
  const [error, setError] = useState<string | null>(null);
  const fields = useDocumentFieldsState(document);

  async function handleSubmit() {
    setError(null);
    if (!fields.counterpartyId) {
      setError(t('counterparty'));
      return;
    }
    try {
      await updateDocument.mutateAsync({
        documentType: fields.documentType,
        documentNumber: fields.documentNumber || undefined,
        documentDate: fields.documentDate || undefined,
        counterpartyId: fields.counterpartyId,
        amount: fields.amount ? Number(fields.amount) : null,
        currency: fields.currency,
        note: fields.note || undefined,
      });
      onSaved();
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <div className="space-y-3">
      <DocumentFieldsForm fields={fields} />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSubmit} disabled={updateDocument.isPending}>{t('save')}</Button>
        <Button size="sm" variant="outline" onClick={onCancel}>{t('cancel')}</Button>
      </div>
    </div>
  );
}
