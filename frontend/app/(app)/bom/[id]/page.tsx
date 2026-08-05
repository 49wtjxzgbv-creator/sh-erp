'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAssembly, useUpdateAssembly } from '@/lib/hooks/use-bom';
import { AssemblyForm } from '@/components/domain/bom/assembly-form';
import { ApiError } from '@/lib/api-client/types';
import type { CreateAssemblyInput } from '@/lib/api-client/bom';
import { LoadingBlock } from '@/components/ui/loading-block';

export default function AssemblyHeaderPage() {
  const params = useParams<{ id: string }>();
  const tc = useTranslations('common');
  const { data: assembly, isLoading } = useAssembly(params.id);
  const updateAssembly = useUpdateAssembly(params.id);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(values: CreateAssemblyInput) {
    setError(null);
    try {
      await updateAssembly.mutateAsync(values);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  if (isLoading || !assembly) {
    return <LoadingBlock />;
  }

  return (
    <div className="max-w-2xl">
      <AssemblyForm assembly={assembly} onSubmit={handleSubmit} submitting={updateAssembly.isPending} submitError={error} />
    </div>
  );
}
