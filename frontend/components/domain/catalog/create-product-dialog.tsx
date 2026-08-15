'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useCreateProduct } from '@/lib/hooks/use-catalog';
import { useRecordStockMovement } from '@/lib/hooks/use-inventory';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { uploadFile } from '@/lib/api-client/files';
import type { CreateProductInput, Product } from '@/lib/api-client/catalog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ProductForm, type InitialStockInput, type ProductFormValues } from './product-form';

export interface CreateProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValues?: Partial<ProductFormValues>;
  onCreated: (product: Product) => void;
}

/** Quick "new product in a dialog" flow, reusing the full ProductForm (same validation as /catalog/new) — used from Invoice recognition to create an unmatched line as a real Product without leaving the page. */
export function CreateProductDialog({ open, onOpenChange, initialValues, onCreated }: CreateProductDialogProps) {
  const t = useTranslations('catalog');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const createProduct = useCreateProduct();
  const recordMovement = useRecordStockMovement();
  const [error, setError] = useState<string | null>(null);
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);

  async function handleSubmit(values: CreateProductInput, initialStock?: InitialStockInput) {
    setError(null);
    try {
      const product = await createProduct.mutateAsync(values);
      if (pendingPhoto) {
        await uploadFile(pendingPhoto, { domain: 'PRODUCT_PHOTO', entityType: 'Product', entityId: product.id }).catch(
          () => undefined,
        );
      }
      if (initialStock) {
        await recordMovement
          .mutateAsync({
            productId: product.id,
            warehouseId: initialStock.warehouseId,
            type: 'RECEIVE',
            qtyDelta: initialStock.qty,
            comment: t('initialQtyComment'),
          })
          .catch(() => undefined);
      }
      setPendingPhoto(null);
      onOpenChange(false);
      onCreated(product);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('newProduct')}</DialogTitle>
        </DialogHeader>
        <ProductForm
          onSubmit={handleSubmit}
          submitting={createProduct.isPending}
          submitError={error}
          pendingPhoto={pendingPhoto}
          onPendingPhotoChange={setPendingPhoto}
          initialValues={initialValues}
        />
      </DialogContent>
    </Dialog>
  );
}
