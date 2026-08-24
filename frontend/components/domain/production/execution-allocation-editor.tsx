'use client';

import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import type { ExecutionAllocationMode, ProductionExecutionAllocationInput } from '@/lib/api-client/production-labor';
import { EmployeePicker } from '@/components/domain/hr/employee-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

export interface EditableAllocationRow {
  key: string;
  employeeId?: string;
  /** Holds whichever of percent/hours applies to the current allocationMode — the other is dropped on submit. */
  value: string;
}

let rowKeySeq = 0;
function newRowKey() {
  rowKeySeq += 1;
  return `allocation-row-${rowKeySeq}`;
}

export function allocationsToRows(allocations: ProductionExecutionAllocationInput[], mode: ExecutionAllocationMode): EditableAllocationRow[] {
  return allocations.map((a) => ({
    key: newRowKey(),
    employeeId: a.employeeId,
    value: String(mode === 'PERCENT' ? a.percent ?? '' : a.hours ?? ''),
  }));
}

/**
 * Same rows-with-picker pattern as worker-editor.tsx. PERCENT values are not
 * required to sum to 100 — the backend normalizes at confirm() time, same
 * convention as ProductionOrderWorker. `value` is purely a weight for
 * splitting the already-computed totalAmount — never itself the fund size,
 * and never an hourly wage in HOURS mode (locked spec — see
 * production-executions.service.ts's own header comment).
 */
export interface ExecutionAllocationEditorProps {
  rows: EditableAllocationRow[];
  onChange: (rows: EditableAllocationRow[]) => void;
  mode: ExecutionAllocationMode;
}

export function ExecutionAllocationEditor({ rows, onChange, mode }: ExecutionAllocationEditorProps) {
  const t = useTranslations('production');
  const tc = useTranslations('common');

  function addRow() {
    onChange([...rows, { key: newRowKey(), value: '' }]);
  }
  function removeRow(key: string) {
    onChange(rows.filter((r) => r.key !== key));
  }
  function updateRow(key: string, patch: Partial<EditableAllocationRow>) {
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('worker')}</TableHead>
            <TableHead className="w-32">{mode === 'PERCENT' ? t('percent') : t('allocationModeHOURS')}</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                {tc('noResults')}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell>
                  <EmployeePicker value={row.employeeId} onChange={(id) => updateRow(row.key, { employeeId: id })} />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    step="any"
                    min={0}
                    value={row.value}
                    onChange={(e) => updateRow(row.key, { value: e.target.value })}
                  />
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" onClick={() => removeRow(row.key)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <Button type="button" variant="outline" size="sm" onClick={addRow}>
        <Plus className="mr-2 h-4 w-4" />
        {t('addAllocationRow')}
      </Button>
    </div>
  );
}

export function rowsToAllocations(rows: EditableAllocationRow[], mode: ExecutionAllocationMode): ProductionExecutionAllocationInput[] | null {
  const out: ProductionExecutionAllocationInput[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const value = Number(row.value);
    if (!row.employeeId || !value || value <= 0) return null;
    if (seen.has(row.employeeId)) return null;
    seen.add(row.employeeId);
    out.push(mode === 'PERCENT' ? { employeeId: row.employeeId, percent: value } : { employeeId: row.employeeId, hours: value });
  }
  return out.length > 0 ? out : null;
}
