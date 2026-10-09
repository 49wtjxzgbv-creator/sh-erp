'use client';

import { useState } from 'react';
import type { Assembly } from '@/lib/api-client/bom';
import { uploadFile } from '@/lib/api-client/files';
import { dataUrlToFile } from './use-create-product-from-part';

export interface PendingAssemblyFromPart {
  article: string;
  name: string;
  photo: File | null;
  glb: ArrayBuffer | null;
}

/**
 * "якщо створюємо специфікацію також автоматично має підтягуватися фото
 * назва артикул і glb файл" (2026-10-09): companion to
 * `useCreateProductFromPart`, same shape, for the "Складові вузли —
 * підвироби" section's own "Створити специфікацію" action — a
 * multi-mesh candidate's own snapshot/article/name/standalone-.glb
 * (already captured by `analyzeGlbParts`, same as a simple part's) seed
 * `CreateAssemblyDialog` instead of navigating to a blank `/bom/new`.
 * The new assembly's own BOM lines are deliberately NOT auto-populated
 * here — see `assembly-parts-check-viewer.tsx`'s own header comment on
 * why a multi-mesh group can't be reliably assumed to be a real,
 * well-formed sub-assembly (a confirmed-live example bundled 184
 * unrelated fasteners under one accidental CAD-export name) — the user
 * fills in "Склад (BOM)" by hand afterward.
 */
export function useCreateAssemblyFromPart() {
  const [pending, setPending] = useState<PendingAssemblyFromPart | null>(null);

  function requestCreate(article: string, suggestedName: string, photoDataUrl: string | null, glb: ArrayBuffer | null) {
    const photo = photoDataUrl ? dataUrlToFile(photoDataUrl, `${article}.png`) : null;
    setPending({ article, name: suggestedName, photo, glb });
  }

  async function handleCreated(assembly: Assembly) {
    const article = pending?.article;
    const glb = pending?.glb ?? null;
    setPending(null);
    if (glb) {
      const glbFile = new File([glb], `${article}.glb`, { type: 'model/gltf-binary' });
      await uploadFile(glbFile, { domain: 'ASSEMBLY_DOCUMENT', entityType: 'Assembly', entityId: assembly.id }).catch(() => undefined);
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
      onCreated: handleCreated,
    },
  };
}
