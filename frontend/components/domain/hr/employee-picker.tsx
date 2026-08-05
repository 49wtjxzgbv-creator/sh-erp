'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useEmployees } from '@/lib/hooks/use-hr';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Third sibling of product-picker.tsx / assembly-picker.tsx — same
 * hand-rolled typeahead shell. Built here (Production's worker-assignment
 * UI needs it) ahead of the full HR module (Task 49), which will reuse it
 * rather than duplicating.
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
  const containerRef = useRef<HTMLDivElement>(null);

  const { data } = useEmployees({ search: query, limit: 20 });

  useEffect(() => {
    if (!value) setQuery('');
  }, [value]);

  return (
    <div ref={containerRef} className="relative">
      <Input
        placeholder={placeholder ?? t('searchEmployees')}
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
            data.items.map((employee) => (
              <button
                type="button"
                key={employee.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setQuery(employee.fullName);
                  setOpen(false);
                  onChange(employee.id, employee.fullName);
                }}
                className={cn(
                  'flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-secondary',
                  employee.id === value && 'bg-secondary',
                )}
              >
                <span className="font-medium">{employee.fullName}</span>
                {employee.position && <span className="text-xs text-muted-foreground">{employee.position}</span>}
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
