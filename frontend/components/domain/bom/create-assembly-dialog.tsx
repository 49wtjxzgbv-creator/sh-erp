'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useCreateAssembly } from '@/lib/hooks/use-bom';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { uploadFile } from '@/lib/api-client/files';
import type { CreateAssemblyInput, Assembly } from '@/lib/api-client/bom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AssemblyForm, type AssemblyFormValues } from './assembly-form';

export interface CreateAssemblyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValues?: Partial<AssemblyFormValues>;
  /** Seeds the "Фото" field with an already-picked File — mirrors `CreateProductDialogProps.initialPhoto`, see its own header comment. */
  initialPhoto?: File | null;
  onCreated: (assembly: Assembly) => void;
}

/** "Нова специфікація" in a dialog, reusing the full AssemblyForm — mirrors `CreateProductDialog`, used from the "Складові вузли — підвироби" section of Деталі (3D) so a multi-mesh candidate's own photo/article/name carry straight over instead of starting a blank `/bom/new`. */
export function CreateAssemblyDialog({ open, onOpenChange, initialValues, initialPhoto, onCreated }: CreateAssemblyDialogProps) {
  const t = useTranslations('bom');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const createAssembly = useCreateAssembly();
  const [error, setError] = useState<string | null>(null);
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(initialPhoto ?? null);

  async function handleSubmit(values: CreateAssemblyInput) {
    setError(null);
    try {
      const assembly = await createAssembly.mutateAsync(values);
      if (pendingPhoto) {
        await uploadFile(pendingPhoto, { domain: 'ASSEMBLY_PHOTO', entityType: 'Assembly', entityId: assembly.id }).catch(
          () => undefined,
        );
      }
      setPendingPhoto(null);
      onOpenChange(false);
      onCreated(assembly);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('newAssembly')}</DialogTitle>
        </DialogHeader>
        <AssemblyForm
          onSubmit={handleSubmit}
          submitting={createAssembly.isPending}
          submitError={error}
          pendingPhoto={pendingPhoto}
          onPendingPhotoChange={setPendingPhoto}
          initialValues={initialValues}
        />
      </DialogContent>
    </Dialog>
  );
}
