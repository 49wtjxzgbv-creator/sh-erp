'use client';

import { useParams } from 'next/navigation';
import { useHasPermission } from '@/lib/hooks/use-roles';
import { AssemblyPartsCheck } from '@/components/domain/bom/assembly-parts-check';

export default function AssemblyPartsCheckPage() {
  const params = useParams<{ id: string }>();
  const canWrite = useHasPermission('assemblies:write');
  return <AssemblyPartsCheck assemblyId={params.id} readOnly={!canWrite} />;
}
