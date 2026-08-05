'use client';

import { useParams } from 'next/navigation';
import { BomEditor } from '@/components/domain/bom/bom-editor';
import { AssemblySpecPrint } from '@/components/domain/bom/assembly-spec-print';

export default function AssemblyComponentsPage() {
  const params = useParams<{ id: string }>();
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <AssemblySpecPrint assemblyId={params.id} />
      </div>
      <BomEditor assemblyId={params.id} />
    </div>
  );
}
