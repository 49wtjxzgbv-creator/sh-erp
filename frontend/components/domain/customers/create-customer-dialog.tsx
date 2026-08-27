'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useCreateCustomer } from '@/lib/hooks/use-customers';
import { useApiErrorMessage } from '@/lib/api-error-message';
import type { CreateCustomerInput, Customer } from '@/lib/api-client/customers';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CustomerForm } from './customer-form';

export interface CreateCustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string;
  onCreated: (customer: Customer) => void;
}

/** Mirrors CreateSupplierDialog — lets a manager add a customer without leaving the quotation/order form they're in the middle of filling out. */
export function CreateCustomerDialog({ open, onOpenChange, initialName, onCreated }: CreateCustomerDialogProps) {
  const t = useTranslations('customers');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const createCustomer = useCreateCustomer();
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(values: CreateCustomerInput) {
    setError(null);
    try {
      const customer = await createCustomer.mutateAsync(values);
      onOpenChange(false);
      onCreated(customer);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('newCustomer')}</DialogTitle>
        </DialogHeader>
        <CustomerForm onSubmit={handleSubmit} submitting={createCustomer.isPending} submitError={error} initialName={initialName} />
      </DialogContent>
    </Dialog>
  );
}
