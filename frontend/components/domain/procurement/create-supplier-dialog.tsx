'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useCreateSupplier } from '@/lib/hooks/use-procurement';
import { useApiErrorMessage } from '@/lib/api-error-message';
import type { CreateSupplierInput, Supplier } from '@/lib/api-client/procurement';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SupplierForm } from './supplier-form';

export interface CreateSupplierDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string;
  onCreated: (supplier: Supplier) => void;
}

/** Quick "new supplier in a dialog" flow, reusing the full SupplierForm (same validation as /procurement/suppliers/new) — used from SupplierPicker so a counterparty missing from the database can be added without leaving the page, same pattern as CreateProductDialog. */
export function CreateSupplierDialog({ open, onOpenChange, initialName, onCreated }: CreateSupplierDialogProps) {
  const t = useTranslations('procurement');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const createSupplier = useCreateSupplier();
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(values: CreateSupplierInput) {
    setError(null);
    try {
      const supplier = await createSupplier.mutateAsync(values);
      onOpenChange(false);
      onCreated(supplier);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('newSupplier')}</DialogTitle>
        </DialogHeader>
        <SupplierForm onSubmit={handleSubmit} submitting={createSupplier.isPending} submitError={error} initialName={initialName} />
      </DialogContent>
    </Dialog>
  );
}
