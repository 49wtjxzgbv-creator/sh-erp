'use client';

import { useAssembly } from '@/lib/hooks/use-bom';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { Avatar } from '@/components/ui/avatar';

/** CustomerOrderItem only carries a raw assemblyId — resolve to a real name/photo, same fix as the print view and other order lists. */
export function AssemblyCell({ assemblyId }: { assemblyId: string }) {
  const { data: assembly } = useAssembly(assemblyId);
  const { data: photosByAssembly } = useFilesForEntities('Assembly', [assemblyId], 'ASSEMBLY_PHOTO');
  return (
    <div className="flex items-center gap-2.5">
      <Avatar src={photosByAssembly?.[assemblyId]?.[0]?.downloadUrl} size="sm" />
      <span className="max-w-[320px] truncate" title={assembly?.name ?? assemblyId}>
        {assembly ? `${assembly.name}${assembly.article ? ` (${assembly.article})` : ''}` : assemblyId}
      </span>
    </div>
  );
}
