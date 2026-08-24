'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSuppliers } from '@/lib/hooks/use-procurement';
import { EntityCombobox } from '@/components/domain/shared/entity-combobox';
import { CreateSupplierDialog } from './create-supplier-dialog';

/**
 * Fourth sibling of product-picker.tsx / assembly-picker.tsx / employee-picker.tsx
 * — same EntityCombobox-backed typeahead shell
 * (components/domain/shared/entity-combobox.tsx). `supplierId` on a
 * PurchaseOrder is optional (the legacy system allowed a free-text-only
 * supplier, Phase 1 §10.6), so this picker only fills the id; the required
 * `supplierNameSnapshot` field stays a separate, independently-editable
 * text input in the form that uses this (see procurement/new/page.tsx) —
 * picking a supplier here is a convenience that pre-fills that name field,
 * not a hard link.
 */
export interface SupplierPickerProps {
  value: string | undefined;
  onChange: (supplierId: string | undefined, label: string | undefined) => void;
  placeholder?: string;
  /** Seeds the search box on mount for a row hydrated from server data where the supplier's name is already known — without this, a picker that already has `value` set shows an empty box until the user re-searches (this component only ever learns a label from its own onChange). Only read once, at mount; not synced on later prop changes. */
  initialLabel?: string;
}

export function SupplierPicker({ value, onChange, placeholder, initialLabel }: SupplierPickerProps) {
  const t = useTranslations('procurement');
  const [query, setQuery] = useState(initialLabel ?? '');
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const { data } = useSuppliers({ search: query, limit: 20 });
  const items = data?.items ?? [];

  useEffect(() => {
    if (!value) setQuery('');
  }, [value]);

  return (
    <>
      <EntityCombobox
        query={query}
        onQueryChange={(next) => {
          setQuery(next);
          if (!next) onChange(undefined, undefined);
        }}
        open={open}
        onOpenChange={setOpen}
        items={items}
        getKey={(supplier) => supplier.id}
        isSelected={(supplier) => supplier.id === value}
        onSelect={(supplier) => {
          setQuery(supplier.name);
          setOpen(false);
          onChange(supplier.id, supplier.name);
        }}
        placeholder={placeholder ?? t('searchSuppliers')}
        renderItem={(supplier) => (
          <span className="flex flex-col items-start">
            <span className="font-medium">{supplier.name}</span>
            {supplier.contactPerson && <span className="text-xs text-muted-foreground">{supplier.contactPerson}</span>}
          </span>
        )}
        footer={
          <button
            type="button"
            className="block w-full border-t px-3 py-2 text-left text-sm text-primary hover:bg-secondary"
            onMouseDown={(e) => {
              e.preventDefault();
              setOpen(false);
              setCreateOpen(true);
            }}
          >
            {query ? t('createSupplierActionNamed', { name: query }) : t('createSupplierAction')}
          </button>
        }
      />
      <CreateSupplierDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialName={query}
        onCreated={(supplier) => {
          setQuery(supplier.name);
          onChange(supplier.id, supplier.name);
        }}
      />
    </>
  );
}
