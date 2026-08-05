'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import type { Employee, CreateEmployeeInput } from '@/lib/api-client/hr';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const employeeSchema = z.object({
  fullName: z.string().min(1),
  position: z.string().optional(),
  phone: z.string().optional(),
  hireDate: z.string().optional(),
  notes: z.string().optional(),
});
type EmployeeFormValues = z.infer<typeof employeeSchema>;

export function employeeToFormValues(employee?: Employee): Partial<EmployeeFormValues> {
  if (!employee) return {};
  return {
    fullName: employee.fullName,
    position: employee.position ?? undefined,
    phone: employee.phone ?? undefined,
    hireDate: employee.hireDate ? employee.hireDate.slice(0, 10) : undefined,
    notes: employee.notes ?? undefined,
  };
}

export interface EmployeeFormProps {
  employee?: Employee;
  onSubmit: (values: CreateEmployeeInput) => Promise<void>;
  submitting: boolean;
  submitError: string | null;
}

export function EmployeeForm({ employee, onSubmit, submitting, submitError }: EmployeeFormProps) {
  const t = useTranslations('hr');
  const tc = useTranslations('common');

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeSchema),
    defaultValues: employeeToFormValues(employee),
  });

  return (
    <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('employeeHeader')}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="fullName">{t('fullName')}</Label>
            <Input id="fullName" {...register('fullName')} />
            {errors.fullName && <p className="text-xs text-destructive">{tc('requiredField')}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="position">{t('position')}</Label>
            <Input id="position" {...register('position')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">{t('phone')}</Label>
            <Input id="phone" {...register('phone')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hireDate">{t('hireDate')}</Label>
            <Input id="hireDate" type="date" {...register('hireDate')} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="notes">{t('notes')}</Label>
            <Textarea id="notes" {...register('notes')} />
          </div>
        </CardContent>
      </Card>
      {submitError && <p className="text-sm text-destructive">{submitError}</p>}
      <Button type="submit" loading={submitting}>
        {tc('save')}
      </Button>
    </form>
  );
}
