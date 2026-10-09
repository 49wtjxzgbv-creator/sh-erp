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
  /**
   * Seeds the "Фото" field with an already-picked File — e.g. the 3D-model
   * viewer's own isolated snapshot of the part this product is being
   * created for (see Step3DViewer's `onCreateProduct`). Only read into
   * state on mount: the caller must remount this component (a `key` tied
   * to whatever identifies the request — e.g. the article) for a new
   * photo to actually take effect on a dialog instance that stays mounted
   * across multiple opens, same as `initialValues` on `ProductForm` itself.
   * Still a normal, user-editable `PendingPhotoField` after that — the
   * user can remove or replace it before saving.
   */
  initialPhoto?: File | null;
  /** The 3D-model part's own solid volume in mm³ (see Step3DViewer's `onCreateProduct` / `analyzeGlbParts`) — lets `ProductForm` offer a material picker that turns this into a weight estimate. Omit entirely (or pass `null`) for every non-3D-model create flow (e.g. Invoice recognition) — the picker just doesn't render. */
  initialVolumeMm3?: number | null;
  /** World-space bounding box in mm (see `analyzeGlbParts`'s own `dimensionsMm` field comment) — shown next to the weight picker as a plain informational line, no DB field backs it. Only ever set from the headless Деталі (3D) flow — the interactive viewer's own single-part "create product" button doesn't compute this. */
  initialDimensionsMm?: { x: number; y: number; z: number } | null;
  /** Exact mesh surface area in mm² (see `analyzeGlbParts`'s own `surfaceAreaMm2`) — same informational-only treatment as `initialDimensionsMm`. */
  initialSurfaceAreaMm2?: number | null;
  onCreated: (product: Product) => void;
}

/** Quick "new product in a dialog" flow, reusing the full ProductForm (same validation as /catalog/new) — used from Invoice recognition to create an unmatched line as a real Product without leaving the page. */
export function CreateProductDialog({
  open,
  onOpenChange,
  initialValues,
  initialPhoto,
  initialVolumeMm3,
  initialDimensionsMm,
  initialSurfaceAreaMm2,
  onCreated,
}: CreateProductDialogProps) {
  const t = useTranslations('catalog');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const createProduct = useCreateProduct();
  const recordMovement = useRecordStockMovement();
  const [error, setError] = useState<string | null>(null);
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(initialPhoto ?? null);

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
          initialVolumeMm3={initialVolumeMm3}
          initialDimensionsMm={initialDimensionsMm}
          initialSurfaceAreaMm2={initialSurfaceAreaMm2}
        />
      </DialogContent>
    </Dialog>
  );
}
