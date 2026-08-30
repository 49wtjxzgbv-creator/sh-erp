'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import type { OrderProductionUnitLine } from '@/lib/api-client/sales';
import { DataTable } from '@/components/domain/data-table/data-table';
import { Avatar } from '@/components/ui/avatar';

/**
 * "План виробництва" order detail page (2026-08-30) — "В роботі" / "Що
 * зроблено" tabs both render the exact same shape (one row per assembly,
 * photo+article+name+qty), so this is shared between both instead of
 * duplicated. Same photo/article-first row convention already used by the
 * Sales payroll-fund breakdown and the Склад summary pages this session.
 */
export function OrderProductionUnitsTable({ lines, isLoading }: { lines: OrderProductionUnitLine[]; isLoading: boolean }) {
  const t = useTranslations('production');
  const tCatalog = useTranslations('catalog');

  const assemblyIds = useMemo(() => lines.map((l) => l.assemblyId), [lines]);
  const { data: photosByAssembly } = useFilesForEntities('Assembly', assemblyIds, 'ASSEMBLY_PHOTO');

  const columns = useMemo<ColumnDef<OrderProductionUnitLine>[]>(
    () => [
      {
        id: 'photo',
        header: tCatalog('photo'),
        cell: ({ row }) => <Avatar src={photosByAssembly?.[row.original.assemblyId]?.[0]?.downloadUrl} size="lg" />,
      },
      { accessorKey: 'article', header: tCatalog('article'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      { accessorKey: 'assemblyName', header: t('assembly'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      {
        accessorKey: 'qty',
        header: () => <span className="block text-right">{t('qty')}</span>,
        cell: ({ getValue }) => <div className="text-right tabular-nums font-medium">{getValue() as number}</div>,
      },
    ],
    [t, tCatalog, photosByAssembly],
  );

  return <DataTable columns={columns} data={lines} isLoading={isLoading} />;
}
