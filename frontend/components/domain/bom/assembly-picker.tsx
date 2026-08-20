'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAssemblies, useAssembly } from '@/lib/hooks/use-bom';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { Avatar } from '@/components/ui/avatar';
import { EntityCombobox } from '@/components/domain/shared/entity-combobox';

/**
 * Sibling to components/domain/catalog/product-picker.tsx — same
 * EntityCombobox-backed typeahead shell (components/domain/shared/entity-combobox.tsx).
 *
 * `excludeId` hides the current assembly from its own picker — a basic UX
 * guard only. The real cycle check (this sub-assembly, or anything it
 * already contains, looping back to the parent) is enforced server-side on
 * save (assemblies.service.ts#assertNoCycle, 409 Conflict) and is not
 * duplicated here.
 */
export interface AssemblyPickerProps {
  value: string | undefined;
  onChange: (assemblyId: string | undefined, label: string | undefined) => void;
  excludeId?: string;
  placeholder?: string;
}

/** Matches ProductPicker's "article — name" convention — this picker previously showed the name alone, dropping the article everywhere it hydrated or was picked (only the dropdown's own sublabel had it). */
function assemblyLabel(assembly: { name: string; article?: string | null }): string {
  return assembly.article ? `${assembly.article} — ${assembly.name}` : assembly.name;
}

export function AssemblyPicker({ value, onChange, excludeId, placeholder }: AssemblyPickerProps) {
  const t = useTranslations('bom');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const { data } = useAssemblies({ search: query, limit: 20 });
  const items = data?.items.filter((a) => a.id !== excludeId) ?? [];
  const assemblyIds = useMemo(() => (data?.items.filter((a) => a.id !== excludeId) ?? []).map((a) => a.id), [data, excludeId]);
  const { data: photosByAssembly } = useFilesForEntities('Assembly', assemblyIds, 'ASSEMBLY_PHOTO');

  // Same hydration fix as ProductPicker: a row loaded from the server only
  // ever has a bare `value` (id) — resolve and fill in the visible text
  // once, so an existing BOM/order line doesn't render as a permanently
  // empty search box.
  const { data: selectedAssembly } = useAssembly(value);
  const { data: photosBySelected } = useFilesForEntities('Assembly', value ? [value] : [], 'ASSEMBLY_PHOTO');
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current || !value || !selectedAssembly) return;
    hydratedRef.current = true;
    setQuery(assemblyLabel(selectedAssembly));
  }, [value, selectedAssembly]);

  useEffect(() => {
    if (!value) {
      setQuery('');
      hydratedRef.current = false;
    }
  }, [value]);

  return (
    <EntityCombobox
      query={query}
      onQueryChange={(next) => {
        setQuery(next);
        if (!next) onChange(undefined, undefined);
      }}
      open={open}
      onOpenChange={setOpen}
      items={items}
      getKey={(assembly) => assembly.id}
      isSelected={(assembly) => assembly.id === value}
      onSelect={(assembly) => {
        setQuery(assemblyLabel(assembly));
        hydratedRef.current = true;
        setOpen(false);
        onChange(assembly.id, assemblyLabel(assembly));
      }}
      placeholder={placeholder ?? t('searchAssemblies')}
      leading={value ? <Avatar src={photosBySelected?.[value]?.[0]?.downloadUrl} size="sm" className="shrink-0" /> : undefined}
      renderItem={(assembly) => (
        <span className="flex items-center gap-2.5">
          <Avatar src={photosByAssembly?.[assembly.id]?.[0]?.downloadUrl} size="sm" />
          <span className="flex min-w-0 flex-col items-start">
            <span className="truncate font-medium">{assembly.name}</span>
            {assembly.article && <span className="truncate text-xs text-muted-foreground">{assembly.article}</span>}
          </span>
        </span>
      )}
    />
  );
}
