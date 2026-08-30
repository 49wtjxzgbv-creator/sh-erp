'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { useFinishedGoodsSummary } from '@/lib/hooks/use-production';
import { useAssembliesByIds } from '@/lib/hooks/use-bom';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import type { FinishedGoodsSummaryLine } from '@/lib/api-client/production';
import { DataTable } from '@/components/domain/data-table/data-table';
import { Avatar } from '@/components/ui/avatar';

/**
 * "Склад → В роботі" (2026-08-30 user request, split off the previously
 * misleadingly-named "Готова продукція"): manufactured units that were
 * created the instant their batch was *started* (ProductionOrdersService
 * #start() generates all of a batch's IN_STOCK units up front, before
 * anyone has actually confirmed doing the work) but whose worker completion
 * has not yet been confirmed via ProductionExecutionsService#confirm() —
 * see FinishedGood.confirmedByExecutionId's own schema comment. Once
 * confirmed (and paid), a unit moves to the sibling "Готова продукція" tab
 * (/inventory/finished-goods) instead — same grouped-by-assembly shape,
 * same drill-down pattern, just the other half of the split.
 */
export default function InProgressGoodsSummaryPage() {
  const t = useTranslations('production');
  const tCatalog = useTranslations('catalog');
  const router = useRouter();

  const { data: lines, isLoading } = useFinishedGoodsSummary('IN_PROGRESS');
  const assemblyIds = useMemo(() => (lines ?? []).map((l) => l.assemblyId), [lines]);
  const { data: assembliesById } = useAssembliesByIds(assemblyIds);
  const { data: photosByAssembly } = useFilesForEntities('Assembly', assemblyIds, 'ASSEMBLY_PHOTO');

  const columns = useMemo<ColumnDef<FinishedGoodsSummaryLine>[]>(
    () => [
      {
        id: 'photo',
        header: tCatalog('photo'),
        cell: ({ row }) => <Avatar src={photosByAssembly?.[row.original.assemblyId]?.[0]?.downloadUrl} size="lg" />,
      },
      {
        id: 'article',
        accessorFn: (row) => row.assemblyId,
        header: tCatalog('article'),
        cell: ({ getValue }) => assembliesById?.get(getValue() as string)?.article ?? '—',
      },
      {
        id: 'name',
        accessorFn: (row) => row.assemblyId,
        header: t('assembly'),
        cell: ({ getValue }) => assembliesById?.get(getValue() as string)?.name ?? (getValue() as string),
      },
      {
        accessorKey: 'qty',
        header: () => <span className="block text-right">{t('qty')}</span>,
        cell: ({ getValue }) => <div className="text-right tabular-nums font-medium">{getValue() as number}</div>,
      },
    ],
    [t, tCatalog, assembliesById, photosByAssembly],
  );

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        data={lines ?? []}
        isLoading={isLoading}
        onRowClick={(line) => router.push(`/inventory/in-progress/${line.assemblyId}`)}
      />
    </div>
  );
}
