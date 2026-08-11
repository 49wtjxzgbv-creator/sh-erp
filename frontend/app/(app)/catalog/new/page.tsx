'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCreateProduct } from '@/lib/hooks/use-catalog';
import { ProductForm } from '@/components/domain/catalog/product-form';
import { ApiError } from '@/lib/api-client/types';
import { uploadFile } from '@/lib/api-client/files';
import type { CreateProductInput } from '@/lib/api-client/catalog';

export default function NewProductPage() {
  const t = useTranslations('catalog');
  const tc = useTranslations('common');
  const router = useRouter();
  const createProduct = useCreateProduct();
  const [error, setError] = useState<string | null>(null);
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);

  async function handleSubmit(values: CreateProductInput) {
    setError(null);
    try {
      const product = await createProduct.mutateAsync(values);
      if (pendingPhoto) {
        // Non-fatal: the product itself is already saved, so a photo
        // upload failure here shouldn't strand the user on the create
        // form — they can retry from the edit page's photo field.
        await uploadFile(pendingPhoto, { domain: 'PRODUCT_PHOTO', entityType: 'Product', entityId: product.id }).catch(
          () => undefined,
        );
      }
      router.replace(`/catalog/${product.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">{t('newProduct')}</h1>
      <ProductForm
        onSubmit={handleSubmit}
        submitting={createProduct.isPending}
        submitError={error}
        pendingPhoto={pendingPhoto}
        onPendingPhotoChange={setPendingPhoto}
      />
    </div>
  );
}
