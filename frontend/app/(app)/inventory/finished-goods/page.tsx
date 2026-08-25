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
import { ReceivePurchasedFinishedGoodsDialog } from '@/components/domain/production/receive-purchased-finished-goods-dialog';
import { useHasPermission } from '@/lib/hooks/use-roles';

/**
 * "Склад → Готова продукція" (2026-08-25 user request): готова продукція
 * is physically warehouse stock, so it should be browsable from here too —
 * not only via Виробництво → Готова продукція's flat per-serial list. One
 * row per Assembly (photo/article/name/qty), never one row per serial —
 * clicking a row drills into the per-serial list (finished-goods/[assemblyId]),
 * which reuses the exact same columns the Production tab's flat list has.
 */
export default function FinishedGoodsSummaryPage() {
  const t = useTranslations('production');
  const tCatalog = useTranslations('catalog');
  const router = useRouter();
  const canReceivePurchased = useHasPermission('finished-goods:manage');

  const { data: lines, isLoading } = useFinishedGoodsSummary();
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
      {canReceivePurchased && (
        <div className="flex justify-end">
          <ReceivePurchasedFinishedGoodsDialog />
        </div>
      )}
      <DataTable
        columns={columns}
        data={lines ?? []}
        isLoading={isLoading}
        onRowClick={(line) => router.push(`/inventory/finished-goods/${line.assemblyId}`)}
      />
    </div>
  );
}
