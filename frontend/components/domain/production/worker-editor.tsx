'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import type { ProductionOrderWorkerInput } from '@/lib/api-client/production';
import { EmployeePicker } from '@/components/domain/hr/employee-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

export interface EditableWorkerRow {
  key: string;
  employeeId?: string;
  percent: string;
}

let rowKeySeq = 0;
function newRowKey() {
  rowKeySeq += 1;
  return `worker-row-${rowKeySeq}`;
}

export function workersToRows(workers: ProductionOrderWorkerInput[]): EditableWorkerRow[] {
  return workers.map((w) => ({ key: newRowKey(), employeeId: w.employeeId, percent: String(w.percent) }));
}

/**
 * Same rows-with-picker pattern as bom-editor.tsx. Percentages are not
 * required to sum to 100 here — the backend normalizes them at start()
 * time (production-orders.service.ts#assertPercentagesNormalizable), so
 * this editor only guards against an empty/zero value per row, not the sum.
 */
export interface WorkerEditorProps {
  rows: EditableWorkerRow[];
  onChange: (rows: EditableWorkerRow[]) => void;
}

export function WorkerEditor({ rows, onChange }: WorkerEditorProps) {
  const t = useTranslations('production');
  const tc = useTranslations('common');

  function addRow() {
    onChange([...rows, { key: newRowKey(), percent: '' }]);
  }
  function removeRow(key: string) {
    onChange(rows.filter((r) => r.key !== key));
  }
  function updateRow(key: string, patch: Partial<EditableWorkerRow>) {
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('worker')}</TableHead>
            <TableHead className="w-32">{t('percent')}</TableHead>
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
                    max={100}
                    value={row.percent}
                    onChange={(e) => updateRow(row.key, { percent: e.target.value })}
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
        {t('addWorker')}
      </Button>
    </div>
  );
}

export function rowsToWorkers(rows: EditableWorkerRow[]): ProductionOrderWorkerInput[] | null {
  const out: ProductionOrderWorkerInput[] = [];
  for (const row of rows) {
    const percent = Number(row.percent);
    if (!row.employeeId || !percent || percent <= 0) return null;
    out.push({ employeeId: row.employeeId, percent });
  }
  return out;
}
