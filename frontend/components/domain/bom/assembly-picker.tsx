'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAssemblies, useAssembly } from '@/lib/hooks/use-bom';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { Input } from '@/components/ui/input';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

/**
 * Sibling to components/domain/catalog/product-picker.tsx — same hand-rolled
 * typeahead pattern (no combobox primitive in this project's Radix set),
 * kept as a separate small component rather than a shared generic
 * <Combobox<T>> abstraction because the two only really share the
 * "Input + absolute list + onMouseDown-before-blur" shell, not the data
 * shape; worth revisiting if a third picker (e.g. Supplier, in Procurement)
 * makes the duplication actually costly.
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
  const containerRef = useRef<HTMLDivElement>(null);

  const { data } = useAssemblies({ search: query, limit: 20 });
  const results = data?.items.filter((a) => a.id !== excludeId) ?? [];
  const assemblyIds = useMemo(() => results.map((a) => a.id), [results]);
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
    <div ref={containerRef} className="relative flex items-center gap-2">
      {value && <Avatar src={photosBySelected?.[value]?.[0]?.downloadUrl} size="sm" className="shrink-0" />}
      <Input
        placeholder={placeholder ?? t('searchAssemblies')}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (!e.target.value) onChange(undefined, undefined);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 100)}
      />
      {open && query && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-64 overflow-auto rounded-md border border-border bg-popover shadow-md">
          {results.length ? (
            results.map((assembly) => (
              <button
                type="button"
                key={assembly.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setQuery(assemblyLabel(assembly));
                  hydratedRef.current = true;
                  setOpen(false);
                  onChange(assembly.id, assemblyLabel(assembly));
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-secondary',
                  assembly.id === value && 'bg-secondary',
                )}
              >
                <Avatar src={photosByAssembly?.[assembly.id]?.[0]?.downloadUrl} size="sm" />
                <span className="flex min-w-0 flex-col items-start">
                  <span className="truncate font-medium">{assembly.name}</span>
                  {assembly.article && <span className="truncate text-xs text-muted-foreground">{assembly.article}</span>}
                </span>
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-sm text-muted-foreground">—</div>
          )}
        </div>
      )}
    </div>
  );
}
