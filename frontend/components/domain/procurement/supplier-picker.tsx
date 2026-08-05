'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSuppliers } from '@/lib/hooks/use-procurement';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Fourth sibling of product-picker.tsx / assembly-picker.tsx / employee-picker.tsx
 * — same hand-rolled typeahead shell. `supplierId` on a PurchaseOrder is
 * optional (the legacy system allowed a free-text-only supplier, Phase 1
 * §10.6), so this picker only fills the id; the required
 * `supplierNameSnapshot` field stays a separate, independently-editable
 * text input in the form that uses this (see procurement/new/page.tsx) —
 * picking a supplier here is a convenience that pre-fills that name field,
 * not a hard link.
 */
export interface SupplierPickerProps {
  value: string | undefined;
  onChange: (supplierId: string | undefined, label: string | undefined) => void;
  placeholder?: string;
}

export function SupplierPicker({ value, onChange, placeholder }: SupplierPickerProps) {
  const t = useTranslations('procurement');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data } = useSuppliers({ search: query, limit: 20 });

  useEffect(() => {
    if (!value) setQuery('');
  }, [value]);

  return (
    <div ref={containerRef} className="relative">
      <Input
        placeholder={placeholder ?? t('searchSuppliers')}
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
        <div className="absolute z-40 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover shadow-md">
          {data?.items.length ? (
            data.items.map((supplier) => (
              <button
                type="button"
                key={supplier.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setQuery(supplier.name);
                  setOpen(false);
                  onChange(supplier.id, supplier.name);
                }}
                className={cn(
                  'flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-secondary',
                  supplier.id === value && 'bg-secondary',
                )}
              >
                <span className="font-medium">{supplier.name}</span>
                {supplier.contactPerson && <span className="text-xs text-muted-foreground">{supplier.contactPerson}</span>}
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
