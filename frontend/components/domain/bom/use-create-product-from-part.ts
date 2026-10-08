'use client';

import { useState } from 'react';
import type { Product } from '@/lib/api-client/catalog';
import { uploadFile } from '@/lib/api-client/files';

/**
 * Converts a captured `data:image/png;base64,...` snapshot (from
 * Step3DViewer's `captureSnapshot` / the headless `analyzeGlbParts`) into
 * a real File for PendingPhotoField/uploadFile — synchronous, no
 * `fetch(dataUrl)` round trip needed for a same-process base64 string.
 */
export function dataUrlToFile(dataUrl: string, filename: string): File | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (!match) return null;
  const [, mimeType, base64] = match;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], filename, { type: mimeType });
}

export interface PendingPartProduct {
  article: string;
  name: string;
  qty: number;
  photo: File | null;
  glb: ArrayBuffer | null;
  volumeMm3: number | null;
}

/**
 * Shared "create a Product straight from a 3D-model part" flow — the
 * part's own article/name/qty/photo-snapshot/glb-export (see
 * Step3DViewer's `onCreateProduct` and `analyzeGlbParts`'s per-part
 * fields) feed a `CreateProductDialog`, and once the product is actually
 * created: it's appended to the assembly's BOM via `onAppend` (the
 * caller's own `useAssemblyBomActions().appendProductLines`) with the
 * part's qty, and the part's standalone `.glb` is uploaded as that new
 * product's own document (non-fatal — the product + BOM line are already
 * saved by that point, a failed document upload shouldn't strand the
 * user). Originally written once inline in `assembly-form.tsx` (the 3D
 * viewer dialog's own "create product" button), now also used by the
 * "Деталі (3D)" tab (`assembly-parts-check.tsx`) so both places share one
 * tested implementation instead of two copies drifting apart.
 *
 * Returns `dialogProps`, spread straight onto `<CreateProductDialog>` —
 * callers still own placing that dialog in their own JSX (so it portals
 * correctly relative to whatever page it's rendered from), just not its
 * state/wiring.
 */
export function useCreateProductFromPart(onAppend: (items: { productId: string; qty: number }[]) => Promise<void>) {
  const [pending, setPending] = useState<PendingPartProduct | null>(null);

  function requestCreate(
    article: string,
    suggestedName: string,
    qty: number,
    photoDataUrl: string | null,
    glb: ArrayBuffer | null,
    volumeMm3: number | null,
  ) {
    const photo = photoDataUrl ? dataUrlToFile(photoDataUrl, `${article}.png`) : null;
    setPending({ article, name: suggestedName, qty, photo, glb, volumeMm3 });
  }

  async function handleCreated(product: Product) {
    const qty = pending?.qty ?? 1;
    const article = pending?.article ?? product.article;
    const glb = pending?.glb ?? null;
    setPending(null);
    await onAppend([{ productId: product.id, qty }]);
    if (glb) {
      const glbFile = new File([glb], `${article}.glb`, { type: 'model/gltf-binary' });
      await uploadFile(glbFile, { domain: 'PRODUCT_DOCUMENT', entityType: 'Product', entityId: product.id }).catch(() => undefined);
    }
  }

  return {
    pending,
    requestCreate,
    dialogProps: {
      key: pending?.article ?? 'none',
      open: pending !== null,
      onOpenChange: (open: boolean) => { if (!open) setPending(null); },
      initialValues: pending ? { article: pending.article, name: pending.name } : undefined,
      initialPhoto: pending?.photo ?? null,
      initialVolumeMm3: pending?.volumeMm3 ?? null,
      onCreated: handleCreated,
    },
  };
}
