'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { useSupplier, useUpdateSupplier, useDeleteSupplier } from '@/lib/hooks/use-procurement';
import { SupplierForm } from '@/components/domain/procurement/supplier-form';
import { ApiError } from '@/lib/api-client/types';
import type { CreateSupplierInput } from '@/lib/api-client/procurement';
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

export default function SupplierDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('procurement');
  const tc = useTranslations('common');

  const { data: supplier, isLoading } = useSupplier(params.id);
  const updateSupplier = useUpdateSupplier(params.id);
  const deleteSupplier = useDeleteSupplier();
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(values: CreateSupplierInput) {
    setError(null);
    try {
      await updateSupplier.mutateAsync(values);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  async function handleDelete() {
    await deleteSupplier.mutateAsync(params.id);
    router.replace('/procurement/suppliers');
  }

  if (isLoading || !supplier) {
    return <LoadingBlock />;
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{supplier.name}</h1>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="destructive" size="sm">
              <Trash2 className="mr-2 h-4 w-4" />
              {tc('delete')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('deleteSupplierConfirmTitle')}</DialogTitle>
              <DialogDescription>{t('deleteSupplierConfirmDescription')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">{tc('cancel')}</Button>
              </DialogClose>
              <Button variant="destructive" loading={deleteSupplier.isPending} onClick={handleDelete}>
                {tc('delete')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <SupplierForm supplier={supplier} onSubmit={handleSubmit} submitting={updateSupplier.isPending} submitError={error} />
    </div>
  );
}
