'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEmployee, useUpdateEmployee, useDeactivateEmployee, useReactivateEmployee } from '@/lib/hooks/use-hr';
import { EmployeeForm } from '@/components/domain/hr/employee-form';
import { useApiErrorMessage } from '@/lib/api-error-message';
import type { CreateEmployeeInput } from '@/lib/api-client/hr';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingBlock } from '@/components/ui/loading-block';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';

export default function EmployeeDetailPage() {
  const params = useParams<{ id: string }>();
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();

  const { data: employee, isLoading } = useEmployee(params.id);
  const updateEmployee = useUpdateEmployee(params.id);
  const deactivateEmployee = useDeactivateEmployee(params.id);
  const reactivateEmployee = useReactivateEmployee(params.id);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(values: CreateEmployeeInput) {
    setError(null);
    try {
      await updateEmployee.mutateAsync(values);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleDeactivate() {
    setError(null);
    try {
      await deactivateEmployee.mutateAsync();
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleReactivate() {
    setError(null);
    try {
      await reactivateEmployee.mutateAsync();
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  if (isLoading || !employee) {
    return <LoadingBlock />;
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{employee.fullName}</h1>
          <Badge variant={employee.status === 'ACTIVE' ? 'success' : 'secondary'}>
            {t(`employeeStatus${employee.status}`)}
          </Badge>
        </div>
        {employee.status === 'ACTIVE' ? (
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="destructive" size="sm">
                {t('deactivateEmployee')}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('deactivateConfirmTitle')}</DialogTitle>
                <DialogDescription>{t('deactivateConfirmDescription')}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">{tc('cancel')}</Button>
                </DialogClose>
                <Button variant="destructive" loading={deactivateEmployee.isPending} onClick={handleDeactivate}>
                  {t('deactivateEmployee')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : (
          <Button size="sm" loading={reactivateEmployee.isPending} onClick={handleReactivate}>
            {t('reactivateEmployee')}
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <EmployeeForm employee={employee} onSubmit={handleSubmit} submitting={updateEmployee.isPending} submitError={null} />
    </div>
  );
}
