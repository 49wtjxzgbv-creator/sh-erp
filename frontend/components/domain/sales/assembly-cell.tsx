'use client';

import { useAssembly } from '@/lib/hooks/use-bom';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

/**
 * CustomerOrderItem only carries a raw assemblyId — resolve to a real
 * name/photo, same fix as the print view and other order lists.
 * `size`/`textClassName` default to the original compact table-row look;
 * callers that need this to read as a heading (e.g. the "Хід виробництва"
 * per-item label, 2026-08-27 user request) opt into a bigger photo/text
 * instead.
 */
export function AssemblyCell({
  assemblyId,
  size = 'sm',
  textClassName,
}: {
  assemblyId: string;
  size?: 'sm' | 'md' | 'lg';
  textClassName?: string;
}) {
  const { data: assembly } = useAssembly(assemblyId);
  const { data: photosByAssembly } = useFilesForEntities('Assembly', [assemblyId], 'ASSEMBLY_PHOTO');
  return (
    <div className="flex items-center gap-2.5">
      <Avatar src={photosByAssembly?.[assemblyId]?.[0]?.downloadUrl} size={size} />
      <span className={cn('max-w-[320px] truncate', textClassName)} title={assembly?.name ?? assemblyId}>
        {assembly ? `${assembly.name}${assembly.article ? ` (${assembly.article})` : ''}` : assemblyId}
      </span>
    </div>
  );
}
