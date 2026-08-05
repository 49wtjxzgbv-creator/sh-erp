'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useFinishedGoods } from '@/lib/hooks/use-production';
import { AssemblyPicker } from '@/components/domain/bom/assembly-picker';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

/**
 * Multi-select checklist of IN_STOCK finished goods, used to build
 * CreateShipmentDto.finishedGoodIds (Phase 1 §3.4 — a shipment always ships
 * specific serials, never a bare qty). Filtered to `status: 'IN_STOCK'`
 * unconditionally (nothing else is shippable — the backend itself rejects
 * anything else, ShipmentsService#create) and optionally narrowed by
 * assembly via the same AssemblyPicker used everywhere else, since
 * queryFinishedGoods has no free-text search of its own.
 */
export interface FinishedGoodSelectorProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function FinishedGoodSelector({ selectedIds, onChange }: FinishedGoodSelectorProps) {
  const t = useTranslations('sales');
  const tc = useTranslations('common');
  const [assemblyId, setAssemblyId] = useState<string | undefined>(undefined);

  const { data, isLoading } = useFinishedGoods({ assemblyId, status: 'IN_STOCK', limit: 100 });

  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  }

  return (
    <div className="space-y-3">
      <AssemblyPicker value={assemblyId} onChange={(id) => setAssemblyId(id)} placeholder={t('filterByAssembly')} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10" />
            <TableHead>{t('serialNumber')}</TableHead>
            <TableHead>{t('manufactureDate')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                {tc('loading')}
              </TableCell>
            </TableRow>
          ) : !data || data.items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                {tc('noResults')}
              </TableCell>
            </TableRow>
          ) : (
            data.items.map((fg) => (
              <TableRow key={fg.id} className="cursor-pointer" onClick={() => toggle(fg.id)}>
                <TableCell>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(fg.id)}
                    onChange={() => toggle(fg.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="h-4 w-4 rounded border-input"
                  />
                </TableCell>
                <TableCell>{fg.serialNumber}</TableCell>
                <TableCell>{new Date(fg.manufactureDate).toLocaleDateString()}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">{t('selectedCount', { count: selectedIds.length })}</p>
    </div>
  );
}
