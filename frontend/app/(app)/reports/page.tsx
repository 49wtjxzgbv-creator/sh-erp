'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { useReorderSuggestions } from '@/lib/hooks/use-reports';
import type { ReorderSuggestion } from '@/lib/api-client/reports';
import { DataTable } from '@/components/domain/data-table/data-table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Products where (qty - reserved) < 2x minQty, worst shortfall first
 * (Phase 1 §3.6). No batch-id-resolution gap here unlike most other list
 * views in this app — the backend already resolves article/name itself
 * (reports.service.ts#getReorderSuggestions), so nothing needs the raw-id
 * workaround documented elsewhere in this codebase.
 */
export default function ReorderSuggestionsPage() {
  const t = useTranslations('reports');
  const [limit, setLimit] = useState('200');

  const { data, isLoading } = useReorderSuggestions({ limit: Number(limit) || 200 });

  const columns = useMemo<ColumnDef<ReorderSuggestion>[]>(
    () => [
      { accessorKey: 'article', header: t('article') },
      { accessorKey: 'name', header: t('productName') },
      { accessorKey: 'qty', header: t('qty') },
      { accessorKey: 'reserved', header: t('reserved') },
      { accessorKey: 'available', header: t('available') },
      { accessorKey: 'minQty', header: t('minQty') },
      { accessorKey: 'target', header: t('target') },
      { accessorKey: 'suggestedOrderQty', header: t('suggestedOrderQty') },
    ],
    [t],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="limit">{t('limit')}</Label>
          <Input id="limit" type="number" min={1} max={500} value={limit} onChange={(e) => setLimit(e.target.value)} className="w-32" />
        </div>
      </div>
      <DataTable columns={columns} data={data ?? []} isLoading={isLoading} />
    </div>
  );
}
