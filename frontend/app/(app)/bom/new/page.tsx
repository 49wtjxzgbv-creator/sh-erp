'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCreateAssembly } from '@/lib/hooks/use-bom';
import { AssemblyForm } from '@/components/domain/bom/assembly-form';
import { ApiError } from '@/lib/api-client/types';
import { uploadFile } from '@/lib/api-client/files';
import type { CreateAssemblyInput } from '@/lib/api-client/bom';

export default function NewAssemblyPage() {
  const t = useTranslations('bom');
  const tc = useTranslations('common');
  const router = useRouter();
  const createAssembly = useCreateAssembly();
  const [error, setError] = useState<string | null>(null);
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);

  async function handleSubmit(values: CreateAssemblyInput) {
    setError(null);
    try {
      const assembly = await createAssembly.mutateAsync(values);
      if (pendingPhoto) {
        await uploadFile(pendingPhoto, { domain: 'ASSEMBLY_PHOTO', entityType: 'Assembly', entityId: assembly.id }).catch(
          () => undefined,
        );
      }
      router.replace(`/bom/${assembly.id}/components`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">{t('newAssembly')}</h1>
      <AssemblyForm
        onSubmit={handleSubmit}
        submitting={createAssembly.isPending}
        submitError={error}
        pendingPhoto={pendingPhoto}
        onPendingPhotoChange={setPendingPhoto}
      />
    </div>
  );
}
