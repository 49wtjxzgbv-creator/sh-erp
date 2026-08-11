'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import type { Assembly, CreateAssemblyInput } from '@/lib/api-client/bom';
import { toNumber } from '@/lib/api-client/decimal';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EntityPhotoField } from '@/components/domain/files/entity-photo-field';
import { PendingPhotoField } from '@/components/domain/files/pending-photo-field';

const assemblySchema = z.object({
  name: z.string().min(1),
  article: z.string().optional(),
  note: z.string().optional(),
  laborCostPerUnit: z.coerce.number().min(0).optional().or(z.literal('')),
  packagingCostPerUnit: z.coerce.number().min(0).optional().or(z.literal('')),
  deliveryCostPerUnit: z.coerce.number().min(0).optional().or(z.literal('')),
  otherCostPerUnit: z.coerce.number().min(0).optional().or(z.literal('')),
});
type AssemblyFormValues = z.infer<typeof assemblySchema>;

export function assemblyToFormValues(assembly?: Assembly): Partial<AssemblyFormValues> {
  if (!assembly) return {};
  return {
    name: assembly.name,
    article: assembly.article ?? undefined,
    note: assembly.note ?? undefined,
    laborCostPerUnit: toNumber(assembly.laborCostPerUnit) ?? undefined,
    packagingCostPerUnit: toNumber(assembly.packagingCostPerUnit) ?? undefined,
    deliveryCostPerUnit: toNumber(assembly.deliveryCostPerUnit) ?? undefined,
    otherCostPerUnit: toNumber(assembly.otherCostPerUnit) ?? undefined,
  };
}

export interface AssemblyFormProps {
  assembly?: Assembly;
  onSubmit: (values: CreateAssemblyInput) => Promise<void>;
  submitting: boolean;
  submitError: string | null;
  /** Only used in create mode (no `assembly` yet) — see PendingPhotoField. */
  pendingPhoto?: File | null;
  onPendingPhotoChange?: (file: File | null) => void;
}

export function AssemblyForm({
  assembly,
  onSubmit,
  submitting,
  submitError,
  pendingPhoto,
  onPendingPhotoChange,
}: AssemblyFormProps) {
  const t = useTranslations('bom');
  const tc = useTranslations('common');

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AssemblyFormValues>({
    resolver: zodResolver(assemblySchema),
    defaultValues: assemblyToFormValues(assembly),
  });

  async function submit(values: AssemblyFormValues) {
    const numeric = (v: number | '' | undefined) => (v === '' || v === undefined ? undefined : v);
    await onSubmit({
      ...values,
      laborCostPerUnit: numeric(values.laborCostPerUnit),
      packagingCostPerUnit: numeric(values.packagingCostPerUnit),
      deliveryCostPerUnit: numeric(values.deliveryCostPerUnit),
      otherCostPerUnit: numeric(values.otherCostPerUnit),
    });
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit(submit)} noValidate>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('photo')}</CardTitle>
        </CardHeader>
        <CardContent>
          {assembly ? (
            <EntityPhotoField domain="ASSEMBLY_PHOTO" entityType="Assembly" entityId={assembly.id} />
          ) : (
            <PendingPhotoField value={pendingPhoto ?? null} onChange={onPendingPhotoChange ?? (() => {})} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('assemblyHeader')}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="name">{t('name')}</Label>
            <Input id="name" {...register('name')} />
            {errors.name && <p className="text-xs text-destructive">{tc('requiredField')}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="article">{t('article')}</Label>
            <Input id="article" {...register('article')} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="note">{t('note')}</Label>
            <Textarea id="note" {...register('note')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="laborCostPerUnit">{t('laborCostPerUnit')}</Label>
            <Input id="laborCostPerUnit" type="number" step="any" {...register('laborCostPerUnit')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="packagingCostPerUnit">{t('packagingCostPerUnit')}</Label>
            <Input id="packagingCostPerUnit" type="number" step="any" {...register('packagingCostPerUnit')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deliveryCostPerUnit">{t('deliveryCostPerUnit')}</Label>
            <Input id="deliveryCostPerUnit" type="number" step="any" {...register('deliveryCostPerUnit')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="otherCostPerUnit">{t('otherCostPerUnit')}</Label>
            <Input id="otherCostPerUnit" type="number" step="any" {...register('otherCostPerUnit')} />
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
