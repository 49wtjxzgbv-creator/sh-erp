'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import type { Customer, CreateCustomerInput } from '@/lib/api-client/customers';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const customerSchema = z.object({
  name: z.string().min(1),
  contactPerson: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().optional(),
  notes: z.string().optional(),
});
type CustomerFormValues = z.infer<typeof customerSchema>;

export function customerToFormValues(customer?: Customer): Partial<CustomerFormValues> {
  if (!customer) return {};
  return {
    name: customer.name,
    contactPerson: customer.contactPerson ?? undefined,
    phone: customer.phone ?? undefined,
    email: customer.email ?? undefined,
    address: customer.address ?? undefined,
    notes: customer.notes ?? undefined,
  };
}

export interface CustomerFormProps {
  customer?: Customer;
  onSubmit: (values: CreateCustomerInput) => Promise<void>;
  submitting: boolean;
  submitError: string | null;
  readOnly?: boolean;
  /** Prefills the name field for a brand-new customer (e.g. text already typed into a picker's search box) — ignored when `customer` is given. */
  initialName?: string;
}

/** Mirrors SupplierForm (components/domain/procurement/supplier-form.tsx) 1:1, plus an `address` field — same lightweight-counterparty shape. */
export function CustomerForm({ customer, onSubmit, submitting, submitError, readOnly, initialName }: CustomerFormProps) {
  const t = useTranslations('customers');
  const tc = useTranslations('common');

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CustomerFormValues>({
    resolver: zodResolver(customerSchema),
    defaultValues: customer ? customerToFormValues(customer) : { name: initialName ?? '' },
  });

  async function submit(values: CustomerFormValues) {
    await onSubmit({ ...values, email: values.email || undefined });
  }

  function scrollToFirstError(formErrors: typeof errors) {
    const elements = Object.keys(formErrors)
      .map((key) => document.getElementById(key))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;
    const topmost = elements.reduce((a, b) => (a.getBoundingClientRect().top <= b.getBoundingClientRect().top ? a : b));
    topmost.scrollIntoView({ behavior: 'smooth', block: 'center' });
    topmost.focus({ preventScroll: true });
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit(submit, scrollToFirstError)} noValidate>
      <fieldset disabled={readOnly} className="contents">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('customerHeader')}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">{t('customerName')}</Label>
              <Input id="name" {...register('name')} />
              {errors.name && <p className="text-xs text-destructive">{tc('requiredField')}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contactPerson">{t('contactPerson')}</Label>
              <Input id="contactPerson" {...register('contactPerson')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">{t('phone')}</Label>
              <Input id="phone" {...register('phone')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">{t('email')}</Label>
              <Input id="email" type="email" {...register('email')} />
              {errors.email && <p className="text-xs text-destructive">{t('invalidEmail')}</p>}
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="address">{t('address')}</Label>
              <Input id="address" {...register('address')} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="notes">{t('notes')}</Label>
              <Textarea id="notes" {...register('notes')} />
            </div>
          </CardContent>
        </Card>
      </fieldset>
      {submitError && <p className="text-sm text-destructive">{submitError}</p>}
      {!readOnly && (
        <Button type="submit" loading={submitting}>
          {tc('save')}
        </Button>
      )}
    </form>
  );
}
