'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import type { Supplier, CreateSupplierInput } from '@/lib/api-client/procurement';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const supplierSchema = z.object({
  name: z.string().min(1),
  contactPerson: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  notes: z.string().optional(),
});
type SupplierFormValues = z.infer<typeof supplierSchema>;

export function supplierToFormValues(supplier?: Supplier): Partial<SupplierFormValues> {
  if (!supplier) return {};
  return {
    name: supplier.name,
    contactPerson: supplier.contactPerson ?? undefined,
    phone: supplier.phone ?? undefined,
    email: supplier.email ?? undefined,
    notes: supplier.notes ?? undefined,
  };
}

export interface SupplierFormProps {
  supplier?: Supplier;
  onSubmit: (values: CreateSupplierInput) => Promise<void>;
  submitting: boolean;
  submitError: string | null;
  /** View-only for a role with `suppliers:read` but not `suppliers:write`. */
  readOnly?: boolean;
  /** Prefills the name field for a brand-new supplier (e.g. the text already typed into a picker's search box) — ignored when `supplier` is given. */
  initialName?: string;
}

export function SupplierForm({ supplier, onSubmit, submitting, submitError, readOnly, initialName }: SupplierFormProps) {
  const t = useTranslations('procurement');
  const tc = useTranslations('common');

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SupplierFormValues>({
    resolver: zodResolver(supplierSchema),
    defaultValues: supplier ? supplierToFormValues(supplier) : { name: initialName ?? '' },
  });

  async function submit(values: SupplierFormValues) {
    await onSubmit({ ...values, email: values.email || undefined });
  }

  function scrollToFirstError(formErrors: typeof errors) {
    const elements = Object.keys(formErrors)
      .map((key) => document.getElementById(key))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;
    const topmost = elements.reduce((a, b) =>
      a.getBoundingClientRect().top <= b.getBoundingClientRect().top ? a : b,
    );
    topmost.scrollIntoView({ behavior: 'smooth', block: 'center' });
    topmost.focus({ preventScroll: true });
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit(submit, scrollToFirstError)} noValidate>
      <fieldset disabled={readOnly} className="contents">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('supplierHeader')}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="name">{t('supplierName')}</Label>
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
