'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCreateSupplier } from '@/lib/hooks/use-procurement';
import { SupplierForm } from '@/components/domain/procurement/supplier-form';
import { ApiError } from '@/lib/api-client/types';
import type { CreateSupplierInput } from '@/lib/api-client/procurement';

export default function NewSupplierPage() {
  const t = useTranslations('procurement');
  const tc = useTranslations('common');
  const router = useRouter();
  const createSupplier = useCreateSupplier();
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(values: CreateSupplierInput) {
    setError(null);
    try {
      const supplier = await createSupplier.mutateAsync(values);
      router.replace(`/procurement/suppliers/${supplier.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">{t('newSupplier')}</h1>
      <SupplierForm onSubmit={handleSubmit} submitting={createSupplier.isPending} submitError={error} />
    </div>
  );
}
