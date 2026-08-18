'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCreateSupplier } from '@/lib/hooks/use-procurement';
import { SupplierForm } from '@/components/domain/procurement/supplier-form';
import { useApiErrorMessage } from '@/lib/api-error-message';
import type { CreateSupplierInput } from '@/lib/api-client/procurement';
import { RequirePermission } from '@/components/domain/auth/require-permission';

export default function NewSupplierPage() {
  const t = useTranslations('procurement');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const router = useRouter();
  const createSupplier = useCreateSupplier();
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(values: CreateSupplierInput) {
    setError(null);
    try {
      const supplier = await createSupplier.mutateAsync(values);
      router.replace(`/procurement/suppliers/${supplier.id}`);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <RequirePermission permission="suppliers:write" redirectTo="/procurement/suppliers">
      <div className="max-w-2xl space-y-4">
        <h1 className="text-xl font-semibold">{t('newSupplier')}</h1>
        <SupplierForm onSubmit={handleSubmit} submitting={createSupplier.isPending} submitError={error} />
      </div>
    </RequirePermission>
  );
}
