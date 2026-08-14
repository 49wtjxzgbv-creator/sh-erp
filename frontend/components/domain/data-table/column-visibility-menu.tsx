'use client';

import { useTranslations } from 'next-intl';
import { Columns3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

export interface ColumnOption {
  id: string;
  label: string;
}

export interface ColumnVisibilityMenuProps {
  columns: ColumnOption[];
  hidden: Set<string>;
  onToggle: (id: string) => void;
}

/**
 * "Which columns to show" picker — pairs with DataTable's `hiddenColumnIds`
 * prop (a plain Set the caller owns, wrapping @tanstack/react-table's own
 * columnVisibility state). Unlike the Catalog grid view's bespoke
 * visibleKeys/basic-column pattern (a different, heavier table), this is
 * the one other DataTable consumers should reuse going forward.
 */
export function ColumnVisibilityMenu({ columns, hidden, onToggle }: ColumnVisibilityMenuProps) {
  const tc = useTranslations('common');
  if (columns.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Columns3 className="mr-2 h-4 w-4" />
          {tc('columns')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{tc('columns')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {columns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={!hidden.has(column.id)}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => onToggle(column.id)}
          >
            {column.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
