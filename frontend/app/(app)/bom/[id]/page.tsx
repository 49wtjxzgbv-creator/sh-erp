'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Copy } from 'lucide-react';
import { useAssembly, useUpdateAssembly, useDuplicateAssembly } from '@/lib/hooks/use-bom';
import { AssemblyForm } from '@/components/domain/bom/assembly-form';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { useHasPermission } from '@/lib/hooks/use-roles';
import type { CreateAssemblyInput } from '@/lib/api-client/bom';
import { Button } from '@/components/ui/button';
import { LoadingBlock } from '@/components/ui/loading-block';

export default function AssemblyHeaderPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('bom');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const { data: assembly, isLoading } = useAssembly(params.id);
  const updateAssembly = useUpdateAssembly(params.id);
  const duplicateAssembly = useDuplicateAssembly();
  const canWrite = useHasPermission('assemblies:write');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(values: CreateAssemblyInput) {
    setError(null);
    try {
      await updateAssembly.mutateAsync(values);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleDuplicate() {
    setError(null);
    try {
      const copy = await duplicateAssembly.mutateAsync(params.id);
      router.push(`/bom/${copy.id}`);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  if (isLoading || !assembly) {
    return <LoadingBlock />;
  }

  return (
    <div className="max-w-2xl space-y-4">
      {canWrite && (
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" loading={duplicateAssembly.isPending} onClick={handleDuplicate}>
            <Copy className="mr-2 h-4 w-4" />
            {t('duplicateAssembly')}
          </Button>
        </div>
      )}
      <AssemblyForm assembly={assembly} onSubmit={handleSubmit} submitting={updateAssembly.isPending} submitError={error} readOnly={!canWrite} />
    </div>
  );
}
