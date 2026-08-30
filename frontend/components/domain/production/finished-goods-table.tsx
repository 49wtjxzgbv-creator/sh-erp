'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { useFinishedGoods } from '@/lib/hooks/use-production';
import { useAssembly } from '@/lib/hooks/use-bom';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import type { FinishedGood, FinishedGoodStatus, FinishedGoodScope } from '@/lib/api-client/production';
import { DataTable } from '@/components/domain/data-table/data-table';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

const PAGE_SIZE = 50;

const FG_STATUS_VARIANT: Record<FinishedGoodStatus, 'secondary' | 'warning' | 'success' | 'destructive'> = {
  IN_STOCK: 'success',
  SHIPPED: 'secondary',
  CONSUMED: 'secondary',
  REWORK: 'warning',
  DEFECTIVE: 'destructive',
};

/** FinishedGood only carries a raw `assemblyId` — resolve it to a real name/article, same fix as Stock Levels' productId. */
function AssemblyNameCell({ assemblyId }: { assemblyId: string }) {
  const { data: assembly } = useAssembly(assemblyId);
  return <span className="block max-w-[300px] truncate" title={assembly?.name ?? assemblyId}>{assembly ? `${assembly.name}${assembly.article ? ` (${assembly.article})` : ''}` : assemblyId}</span>;
}

function AssemblyPhotoCell({ assemblyId }: { assemblyId: string }) {
  const { data: photosByAssembly } = useFilesForEntities('Assembly', [assemblyId], 'ASSEMBLY_PHOTO');
  return <Avatar src={photosByAssembly?.[assemblyId]?.[0]?.downloadUrl} size="sm" />;
}

/**
 * Flat per-serial finished-goods list, with a status filter — the shared
 * body behind Виробництво → Готова продукція (no `assemblyId`/`scope`,
 * every unit of every assembly regardless of confirmation) and Склад →
 * В роботі / Готова продукція's drill-downs (one assembly's units only,
 * reached by clicking a grouped summary row, `scope` matching whichever
 * tab it was clicked from).
 */
export function FinishedGoodsTable({ assemblyId, scope }: { assemblyId?: string; scope?: FinishedGoodScope }) {
  const t = useTranslations('production');
  const router = useRouter();
  const [status, setStatus] = useState<FinishedGoodStatus | undefined>(undefined);
  const [offset, setOffset] = useState(0);

  const { data, isLoading } = useFinishedGoods({ assemblyId, status, scope, limit: PAGE_SIZE, offset });

  const columns = useMemo<ColumnDef<FinishedGood>[]>(
    () => [
      { accessorKey: 'serialNumber', header: t('serialNumber') },
      {
        id: 'photo',
        header: '',
        cell: ({ row }) => <AssemblyPhotoCell assemblyId={row.original.assemblyId} />,
      },
      {
        accessorKey: 'assemblyId',
        header: t('assembly'),
        cell: ({ getValue }) => <AssemblyNameCell assemblyId={getValue() as string} />,
      },
      {
        accessorKey: 'status',
        header: t('status'),
        cell: ({ getValue }) => {
          const s = getValue() as FinishedGoodStatus;
          return <Badge variant={FG_STATUS_VARIANT[s]}>{t(`fgStatus${s}`)}</Badge>;
        },
      },
      {
        accessorKey: 'manufactureDate',
        header: t('manufactureDate'),
        cell: ({ getValue }) => new Date(getValue() as string).toLocaleDateString(),
      },
      {
        accessorKey: 'productionOrderId',
        header: t('origin'),
        cell: ({ getValue }) => (
          <Badge variant={getValue() ? 'secondary' : 'warning'}>{getValue() ? t('originManufactured') : t('originPurchased')}</Badge>
        ),
      },
    ],
    [t],
  );

  return (
    <div className="space-y-4">
      <Select value={status ?? '__all'} onValueChange={(v) => { setStatus(v === '__all' ? undefined : (v as FinishedGoodStatus)); setOffset(0); }}>
        <SelectTrigger className="w-48">
          <SelectValue placeholder={t('filterByStatus')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">{t('allStatuses')}</SelectItem>
          <SelectItem value="IN_STOCK">{t('fgStatusIN_STOCK')}</SelectItem>
          <SelectItem value="SHIPPED">{t('fgStatusSHIPPED')}</SelectItem>
          <SelectItem value="CONSUMED">{t('fgStatusCONSUMED')}</SelectItem>
          <SelectItem value="REWORK">{t('fgStatusREWORK')}</SelectItem>
          <SelectItem value="DEFECTIVE">{t('fgStatusDEFECTIVE')}</SelectItem>
        </SelectContent>
      </Select>

      <div data-tour="finished-goods-list">
        <DataTable
          columns={columns}
          data={data?.items ?? []}
          isLoading={isLoading}
          onRowClick={(fg) => router.push(`/production/finished-goods/${fg.id}`)}
          pagination={data ? { offset, limit: PAGE_SIZE, total: data.total, onOffsetChange: setOffset } : undefined}
        />
      </div>
    </div>
  );
}
