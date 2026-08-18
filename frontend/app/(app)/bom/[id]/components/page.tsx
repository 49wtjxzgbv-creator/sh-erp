'use client';

import { useParams } from 'next/navigation';
import { BomEditor } from '@/components/domain/bom/bom-editor';
import { AssemblySpecPrint } from '@/components/domain/bom/assembly-spec-print';
import { useHasPermission } from '@/lib/hooks/use-roles';

export default function AssemblyComponentsPage() {
  const params = useParams<{ id: string }>();
  const canWrite = useHasPermission('assemblies:write');
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <AssemblySpecPrint assemblyId={params.id} />
      </div>
      <BomEditor assemblyId={params.id} readOnly={!canWrite} />
    </div>
  );
}
