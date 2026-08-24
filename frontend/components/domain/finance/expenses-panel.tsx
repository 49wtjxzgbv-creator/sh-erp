'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  useFinanceDocuments,
  useFinanceExpenses,
  useCreateFinanceExpense,
  useUpdateFinanceExpense,
  useDeleteFinanceExpense,
  useCustomerOrderFinanceDocuments,
  useCustomerOrderFinanceExpenses,
  useCreateCustomerOrderExpense,
  useUpdateCustomerOrderExpense,
  useDeleteCustomerOrderExpense,
} from '@/lib/hooks/use-finance';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { formatMoney } from '@/lib/finance-format';
import type { PurchaseOrderExpenseCategory, PurchaseOrderExpense, CustomerOrderExpense } from '@/lib/api-client/finance';
import type { FinanceKind } from './document-form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

const EXPENSE_CATEGORIES: PurchaseOrderExpenseCategory[] = ['SHIPPING', 'CUSTOMS', 'INSURANCE', 'OTHER'];

interface ExpenseFieldsState {
  category: PurchaseOrderExpenseCategory;
  setCategory: (v: PurchaseOrderExpenseCategory) => void;
  amount: string;
  setAmount: (v: string) => void;
  currency: string;
  setCurrency: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  documentId: string | undefined;
  setDocumentId: (v: string | undefined) => void;
  reset: () => void;
}

function useExpenseFieldsState(initial?: PurchaseOrderExpense | CustomerOrderExpense): ExpenseFieldsState {
  const [category, setCategory] = useState<PurchaseOrderExpenseCategory>(initial?.category ?? 'SHIPPING');
  const [amount, setAmount] = useState(initial?.amount != null ? String(initial.amount) : '');
  const [currency, setCurrency] = useState(initial?.currency ?? 'EUR');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [documentId, setDocumentId] = useState<string | undefined>(initial?.documentId ?? undefined);

  function reset() {
    setCategory(initial?.category ?? 'SHIPPING');
    setAmount(initial?.amount != null ? String(initial.amount) : '');
    setCurrency(initial?.currency ?? 'EUR');
    setDescription(initial?.description ?? '');
    setDocumentId(initial?.documentId ?? undefined);
  }

  return { category, setCategory, amount, setAmount, currency, setCurrency, description, setDescription, documentId, setDocumentId, reset };
}

function ExpenseFieldsForm({ fields, documentOptions }: { fields: ExpenseFieldsState; documentOptions: { id: string; label: string }[] }) {
  const t = useTranslations('finance');
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>{t('category')}</Label>
        <Select value={fields.category} onValueChange={(v) => fields.setCategory(v as PurchaseOrderExpenseCategory)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {EXPENSE_CATEGORIES.map((v) => <SelectItem key={v} value={v}>{t(`expenseCategory${v}`)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="exp-amount">{t('amount')}</Label>
          <Input id="exp-amount" type="number" step="0.01" min="0.01" value={fields.amount} onChange={(e) => fields.setAmount(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="exp-currency">{t('currency')}</Label>
          <Input id="exp-currency" value={fields.currency} maxLength={3} onChange={(e) => fields.setCurrency(e.target.value.toUpperCase())} />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="exp-description">{t('description')}</Label>
        <Textarea id="exp-description" value={fields.description} onChange={(e) => fields.setDescription(e.target.value)} />
      </div>
      {documentOptions.length > 0 && (
        <div className="space-y-1">
          <Label>{t('linkedDocument')}</Label>
          <Select value={fields.documentId ?? '__none'} onValueChange={(v) => fields.setDocumentId(v === '__none' ? undefined : v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">{t('noLinkedDocument')}</SelectItem>
              {documentOptions.map((d) => <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

function useDocumentOptions(kind: FinanceKind, ownerId: string) {
  const t = useTranslations('finance');
  const poDocuments = useFinanceDocuments(kind === 'purchase-order' ? ownerId : undefined);
  const coDocuments = useCustomerOrderFinanceDocuments(kind === 'customer-order' ? ownerId : undefined);
  const documents = kind === 'purchase-order' ? poDocuments.data : coDocuments.data;
  return (documents ?? []).map((d) => ({ id: d.id, label: d.documentNumber || t(`documentType${d.documentType}`) }));
}

function ExpenseFormDialog({ kind, ownerId, documentOptions }: { kind: FinanceKind; ownerId: string; documentOptions: { id: string; label: string }[] }) {
  const t = useTranslations('finance');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const createPo = useCreateFinanceExpense(ownerId);
  const createCo = useCreateCustomerOrderExpense(ownerId);
  const createExpense = kind === 'purchase-order' ? createPo : createCo;
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fields = useExpenseFieldsState();

  async function handleSubmit() {
    setError(null);
    const value = Number(fields.amount);
    if (!value || value <= 0) {
      setError(t('amount'));
      return;
    }
    try {
      await createExpense.mutateAsync({
        category: fields.category,
        amount: value,
        currency: fields.currency,
        description: fields.description || undefined,
        documentId: fields.documentId,
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
        <Button size="sm">{t('addExpense')}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('addExpense')}</DialogTitle>
        </DialogHeader>
        <ExpenseFieldsForm fields={fields} documentOptions={documentOptions} />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={createExpense.isPending}>{t('create')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExpenseEditDialog({
  kind,
  ownerId,
  expense,
  documentOptions,
  open,
  onOpenChange,
}: {
  kind: FinanceKind;
  ownerId: string;
  expense: PurchaseOrderExpense | CustomerOrderExpense;
  documentOptions: { id: string; label: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('finance');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const updatePo = useUpdateFinanceExpense(ownerId);
  const updateCo = useUpdateCustomerOrderExpense(ownerId);
  const updateExpense = kind === 'purchase-order' ? updatePo : updateCo;
  const [error, setError] = useState<string | null>(null);
  const fields = useExpenseFieldsState(expense);

  async function handleSubmit() {
    setError(null);
    const value = Number(fields.amount);
    if (!value || value <= 0) {
      setError(t('amount'));
      return;
    }
    try {
      await updateExpense.mutateAsync({
        id: expense.id,
        dto: {
          category: fields.category,
          amount: value,
          currency: fields.currency,
          description: fields.description || undefined,
          documentId: fields.documentId ?? null,
        },
      });
      onOpenChange(false);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('editExpense')}</DialogTitle>
        </DialogHeader>
        <ExpenseFieldsForm fields={fields} documentOptions={documentOptions} />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={updateExpense.isPending}>{t('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Expense list + create/edit dialogs — kind-parametrized replacement for the duplicated ExpensesPanel in the PO-Finance and CustomerOrder-Finance pages, also reused inline per linked-PO card. */
export function ExpensesPanel({ kind, ownerId, canManage, title }: { kind: FinanceKind; ownerId: string; canManage: boolean; title?: string }) {
  const t = useTranslations('finance');
  const tc = useTranslations('common');
  const poExpenses = useFinanceExpenses(kind === 'purchase-order' ? ownerId : undefined);
  const coExpenses = useCustomerOrderFinanceExpenses(kind === 'customer-order' ? ownerId : undefined);
  const expenses = kind === 'purchase-order' ? poExpenses.data : coExpenses.data;
  const documentOptions = useDocumentOptions(kind, ownerId);
  const documentLabelById = new Map(documentOptions.map((d) => [d.id, d.label]));
  const deletePo = useDeleteFinanceExpense(ownerId);
  const deleteCo = useDeleteCustomerOrderExpense(ownerId);
  const deleteExpense = kind === 'purchase-order' ? deletePo : deleteCo;
  const [editingExpense, setEditingExpense] = useState<PurchaseOrderExpense | CustomerOrderExpense | undefined>();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{title ?? t('expenses')}</CardTitle>
        {canManage && <ExpenseFormDialog kind={kind} ownerId={ownerId} documentOptions={documentOptions} />}
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
                <>
                  <button type="button" className="text-xs text-primary hover:underline" onClick={() => setEditingExpense(exp)}>
                    {tc('edit')}
                  </button>
                  <button type="button" className="text-xs text-destructive hover:underline" onClick={() => deleteExpense.mutate(exp.id)}>
                    {tc('delete')}
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </CardContent>
      {editingExpense && (
        <ExpenseEditDialog
          kind={kind}
          ownerId={ownerId}
          expense={editingExpense}
          documentOptions={documentOptions}
          open={Boolean(editingExpense)}
          onOpenChange={(o) => !o && setEditingExpense(undefined)}
        />
      )}
    </Card>
  );
}
