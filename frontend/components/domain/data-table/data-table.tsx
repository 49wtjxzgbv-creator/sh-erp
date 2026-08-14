'use client';

import { useMemo } from 'react';
import {
  type ColumnDef,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useTranslations } from 'next-intl';
import { Inbox } from 'lucide-react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * Shared "spreadsheet-style grid" used across every module's list view
 * (Catalog now, Inventory/Procurement/Sales/etc. as their tasks land).
 * Deliberately thin over @tanstack/react-table: it owns column
 * definitions/rendering, the caller owns data fetching (TanStack Query) and
 * pagination state, so this component has no opinion about where rows come
 * from.
 *
 * Always renders a leading row-number column (not opt-in, unlike
 * `selection` below) — numbers continue across pages via `pagination.offset`
 * rather than resetting to 1 on every page.
 */
export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  isLoading?: boolean;
  onRowClick?: (row: TData) => void;
  pagination?: {
    offset: number;
    limit: number;
    total: number;
    onOffsetChange: (offset: number) => void;
  };
  /** Shown in place of the default "no results" empty state — pass a module-specific icon/title/description/action (e.g. a "Create first product" button). */
  emptyState?: React.ReactNode;
  /**
   * Opt-in row-selection checkboxes (a leading column, header checkbox
   * toggles every currently-loaded row). Selection state lives with the
   * caller — same "this component owns rendering, the caller owns state"
   * split as `pagination` above — so a bulk action (e.g. delete) can read
   * `selectedIds` directly without this component needing to know what
   * that action is.
   */
  selection?: {
    selectedIds: Set<string>;
    onSelectionChange: (ids: Set<string>) => void;
    getRowId: (row: TData) => string;
  };
  /** Column ids to hide — plain Set the caller owns (see ColumnVisibilityMenu), threaded into @tanstack/react-table's own columnVisibility state. */
  hiddenColumnIds?: Set<string>;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  isLoading,
  onRowClick,
  pagination,
  emptyState,
  selection,
  hiddenColumnIds,
}: DataTableProps<TData, TValue>) {
  const tc = useTranslations('common');
  const columnVisibility = useMemo<VisibilityState | undefined>(() => {
    if (!hiddenColumnIds || hiddenColumnIds.size === 0) return undefined;
    const visibility: VisibilityState = {};
    hiddenColumnIds.forEach((id) => {
      visibility[id] = false;
    });
    return visibility;
  }, [hiddenColumnIds]);
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    state: columnVisibility ? { columnVisibility } : undefined,
  });

  const rowIds = selection ? data.map(selection.getRowId) : [];
  const allSelected = selection ? rowIds.length > 0 && rowIds.every((id) => selection.selectedIds.has(id)) : false;
  const someSelected = selection ? rowIds.some((id) => selection.selectedIds.has(id)) : false;

  function toggleAll() {
    if (!selection) return;
    const next = new Set(selection.selectedIds);
    if (allSelected) rowIds.forEach((id) => next.delete(id));
    else rowIds.forEach((id) => next.add(id));
    selection.onSelectionChange(next);
  }

  function toggleOne(id: string) {
    if (!selection) return;
    const next = new Set(selection.selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selection.onSelectionChange(next);
  }

  // Continues across pages (offset + index), not reset to 1 on every page —
  // otherwise page 2 would restart at "1" right under page 1's "50", which
  // reads as a data error rather than a page boundary.
  const rowNumberBase = pagination?.offset ?? 0;

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              <TableHead className="w-10 text-right">{tc('rowNumber')}</TableHead>
              {selection && (
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-input"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected && !allSelected;
                    }}
                    onChange={toggleAll}
                    aria-label={tc('selectAll')}
                  />
                </TableHead>
              )}
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {isLoading ? (
            Array.from({ length: 6 }).map((_, rowIdx) => (
              <TableRow key={rowIdx}>
                <TableCell>
                  <Skeleton className="h-4 w-4" />
                </TableCell>
                {selection && (
                  <TableCell>
                    <Skeleton className="h-4 w-4" />
                  </TableCell>
                )}
                {columns.map((_col, colIdx) => (
                  <TableCell key={colIdx}>
                    <Skeleton className="h-4 w-full max-w-[10rem]" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length + 1 + (selection ? 1 : 0)} className="p-0">
                {emptyState ?? <EmptyState icon={Inbox} title={tc('noResults')} />}
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row, rowIndex) => {
              const rowId = selection?.getRowId(row.original);
              return (
                <TableRow
                  key={row.id}
                  onClick={() => onRowClick?.(row.original)}
                  className={onRowClick ? 'cursor-pointer' : undefined}
                >
                  <TableCell className="text-right text-muted-foreground">{rowNumberBase + rowIndex + 1}</TableCell>
                  {selection && rowId !== undefined && (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-input"
                        checked={selection.selectedIds.has(rowId)}
                        onChange={() => toggleOne(rowId)}
                        aria-label={tc('selectRow')}
                      />
                    </TableCell>
                  )}
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      {pagination && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {Math.min(pagination.offset + 1, pagination.total)}–
            {Math.min(pagination.offset + pagination.limit, pagination.total)} / {pagination.total}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.offset === 0}
              onClick={() => pagination.onOffsetChange(Math.max(0, pagination.offset - pagination.limit))}
            >
              {tc('back')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.offset + pagination.limit >= pagination.total}
              onClick={() => pagination.onOffsetChange(pagination.offset + pagination.limit)}
            >
              {tc('next')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
