'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { useProductionOrders } from '@/lib/hooks/use-production';
import { useAssembly } from '@/lib/hooks/use-bom';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import type { ProductionOrder, ProductionOrderStatus } from '@/lib/api-client/production';
import { DataTable } from '@/components/domain/data-table/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { LearnThisButton } from '@/components/domain/training/learn-this-button';
import { useHasPermission } from '@/lib/hooks/use-roles';

const PAGE_SIZE = 50;

const STATUS_VARIANT: Record<ProductionOrderStatus, 'secondary' | 'warning' | 'success' | 'destructive'> = {
  PLANNED: 'secondary',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'destructive',
};

/** Production orders only carry a raw `assemblyId` — resolve it to a real name/article for the list, same fix as Stock Levels' productId. */
function AssemblyNameCell({ assemblyId }: { assemblyId: string }) {
  const { data: assembly } = useAssembly(assemblyId);
  return <span className="max-w-[300px] truncate block" title={assembly?.name ?? assemblyId}>{assembly ? `${assembly.name}${assembly.article ? ` (${assembly.article})` : ''}` : assemblyId}</span>;
}

function AssemblyPhotoCell({ assemblyId }: { assemblyId: string }) {
  const { data: photosByAssembly } = useFilesForEntities('Assembly', [assemblyId], 'ASSEMBLY_PHOTO');
  return <Avatar src={photosByAssembly?.[assemblyId]?.[0]?.downloadUrl} size="sm" />;
}

export default function ProductionOrdersPage() {
  const t = useTranslations('production');
  const router = useRouter();
  const [status, setStatus] = useState<ProductionOrderStatus | undefined>(undefined);
  const [offset, setOffset] = useState(0);

  const { data, isLoading } = useProductionOrders({ status, limit: PAGE_SIZE, offset });

  const columns = useMemo<ColumnDef<ProductionOrder>[]>(
    () => [
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
      { accessorKey: 'unitsPlanned', header: t('unitsPlanned') },
      {
        id: 'customerOrder',
        header: t('customerOrder'),
        cell: ({ row }) => {
          const order = row.original.customerOrder;
          if (!order) return <span className="text-muted-foreground">—</span>;
          return (
            <Link
              href={`/sales/${order.id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-primary hover:underline"
            >
              {order.clientName}{order.orderNumber ? ` — № ${order.orderNumber}` : ''}
            </Link>
          );
        },
      },
      {
        accessorKey: 'status',
        header: t('status'),
        cell: ({ getValue }) => {
          const s = getValue() as ProductionOrderStatus;
          return <Badge variant={STATUS_VARIANT[s]}>{t(`status${s}`)}</Badge>;
        },
      },
      {
        accessorKey: 'createdAt',
        header: t('createdAt'),
        cell: ({ getValue }) => new Date(getValue() as string).toLocaleDateString(),
      },
    ],
    [t],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select value={status ?? '__all'} onValueChange={(v) => { setStatus(v === '__all' ? undefined : (v as ProductionOrderStatus)); setOffset(0); }}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder={t('filterByStatus')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">{t('allStatuses')}</SelectItem>
            <SelectItem value="PLANNED">{t('statusPLANNED')}</SelectItem>
            <SelectItem value="IN_PROGRESS">{t('statusIN_PROGRESS')}</SelectItem>
            <SelectItem value="COMPLETED">{t('statusCOMPLETED')}</SelectItem>
            <SelectItem value="CANCELLED">{t('statusCANCELLED')}</SelectItem>
          </SelectContent>
        </Select>
        <LearnThisButton courseId="production-orders" label="Навчитися працювати з виробництвом" />
        {useHasPermission('production-orders:manage') && (
          <Button asChild>
            <Link href="/production/new" data-tour="production-new-button">
              <Plus className="mr-2 h-4 w-4" />
              {t('newOrder')}
            </Link>
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        onRowClick={(order) => router.push(`/production/${order.id}`)}
        pagination={data ? { offset, limit: PAGE_SIZE, total: data.total, onOffsetChange: setOffset } : undefined}
      />
    </div>
  );
}
