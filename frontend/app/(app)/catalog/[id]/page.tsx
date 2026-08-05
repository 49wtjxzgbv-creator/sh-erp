'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { useProduct, useUpdateProduct, useDeleteProduct } from '@/lib/hooks/use-catalog';
import { ProductForm } from '@/components/domain/catalog/product-form';
import { ApiError } from '@/lib/api-client/types';
import type { CreateProductInput } from '@/lib/api-client/catalog';
import { Button } from '@/components/ui/button';
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

export default function EditProductPage() {
  const params = useParams<{ id: string }>();
  const t = useTranslations('catalog');
  const tc = useTranslations('common');
  const router = useRouter();

  const { data: product, isLoading } = useProduct(params.id);
  const updateProduct = useUpdateProduct(params.id);
  const deleteProduct = useDeleteProduct();
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(values: CreateProductInput) {
    setError(null);
    try {
      await updateProduct.mutateAsync(values);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  async function handleDelete() {
    await deleteProduct.mutateAsync(params.id);
    router.replace('/catalog');
  }

  if (isLoading || !product) {
    return <p className="text-sm text-muted-foreground">{tc('loading')}</p>;
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          {t('editProduct')} — {product.article}
        </h1>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="destructive" size="sm">
              <Trash2 className="mr-2 h-4 w-4" />
              {tc('delete')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('deleteConfirmTitle')}</DialogTitle>
              <DialogDescription>{t('deleteConfirmDescription')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">{tc('cancel')}</Button>
              </DialogClose>
              <Button variant="destructive" loading={deleteProduct.isPending} onClick={handleDelete}>
                {tc('delete')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <ProductForm
        product={product}
        onSubmit={handleSubmit}
        submitting={updateProduct.isPending}
        submitError={error}
      />
    </div>
  );
}
