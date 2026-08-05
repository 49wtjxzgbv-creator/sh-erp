'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCreateEmployee } from '@/lib/hooks/use-hr';
import { EmployeeForm } from '@/components/domain/hr/employee-form';
import { ApiError } from '@/lib/api-client/types';
import type { CreateEmployeeInput } from '@/lib/api-client/hr';

export default function NewEmployeePage() {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const router = useRouter();
  const createEmployee = useCreateEmployee();
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(values: CreateEmployeeInput) {
    setError(null);
    try {
      const employee = await createEmployee.mutateAsync(values);
      router.replace(`/hr/${employee.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">{t('newEmployee')}</h1>
      <EmployeeForm onSubmit={handleSubmit} submitting={createEmployee.isPending} submitError={error} />
    </div>
  );
}
