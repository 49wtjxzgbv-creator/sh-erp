'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useCustomers } from '@/lib/hooks/use-customers';
import { EntityCombobox } from '@/components/domain/shared/entity-combobox';
import { CreateCustomerDialog } from './create-customer-dialog';

/** Sixth sibling of the EntityCombobox-backed pickers (product/assembly/customer-order/supplier/employee) — mirrors SupplierPicker exactly, including the inline "+ create" footer, since Customer is the same kind of lightweight counterparty directory. */
export interface CustomerPickerProps {
  value: string | undefined;
  onChange: (customerId: string | undefined, label: string | undefined) => void;
  placeholder?: string;
  /** Seeds the search box on mount when hydrating a row whose customer name is already known (e.g. an existing quotation). */
  initialLabel?: string;
}

export function CustomerPicker({ value, onChange, placeholder, initialLabel }: CustomerPickerProps) {
  const t = useTranslations('customers');
  const [query, setQuery] = useState(initialLabel ?? '');
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const { data } = useCustomers({ search: query, limit: 20 });
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
        getKey={(customer) => customer.id}
        isSelected={(customer) => customer.id === value}
        onSelect={(customer) => {
          setQuery(customer.name);
          setOpen(false);
          onChange(customer.id, customer.name);
        }}
        placeholder={placeholder ?? t('searchCustomers')}
        renderItem={(customer) => (
          <span className="flex flex-col items-start">
            <span className="font-medium">{customer.name}</span>
            {customer.contactPerson && <span className="text-xs text-muted-foreground">{customer.contactPerson}</span>}
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
            {query ? t('createCustomerActionNamed', { name: query }) : t('createCustomerAction')}
          </button>
        }
      />
      <CreateCustomerDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialName={query}
        onCreated={(customer) => {
          setQuery(customer.name);
          onChange(customer.id, customer.name);
        }}
      />
    </>
  );
}
