'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useEmployees } from '@/lib/hooks/use-hr';
import { EntityCombobox } from '@/components/domain/shared/entity-combobox';

/**
 * Third sibling of product-picker.tsx / assembly-picker.tsx — same
 * EntityCombobox-backed typeahead shell (components/domain/shared/entity-combobox.tsx).
 * Built here (Production's worker-assignment UI needs it) ahead of the full
 * HR module (Task 49), which will reuse it rather than duplicating.
 */
export interface EmployeePickerProps {
  value: string | undefined;
  onChange: (employeeId: string | undefined, label: string | undefined) => void;
  placeholder?: string;
}

export function EmployeePicker({ value, onChange, placeholder }: EmployeePickerProps) {
  const t = useTranslations('production');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const { data } = useEmployees({ search: query, limit: 20 });
  const items = data?.items ?? [];

  useEffect(() => {
    if (!value) setQuery('');
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
      getKey={(employee) => employee.id}
      isSelected={(employee) => employee.id === value}
      onSelect={(employee) => {
        setQuery(employee.fullName);
        setOpen(false);
        onChange(employee.id, employee.fullName);
      }}
      placeholder={placeholder ?? t('searchEmployees')}
      renderItem={(employee) => (
        <span className="flex flex-col items-start">
          <span className="font-medium">{employee.fullName}</span>
          {employee.position && <span className="text-xs text-muted-foreground">{employee.position}</span>}
        </span>
      )}
    />
  );
}
