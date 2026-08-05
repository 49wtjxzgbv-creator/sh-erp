'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { usePurchaseOrders } from '@/lib/hooks/use-procurement';
import type { PurchaseOrder, PurchaseOrderStatus } from '@/lib/api-client/procurement';
import { DataTable } from '@/components/domain/data-table/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

const PAGE_SIZE = 50;

const STATUS_VARIANT: Record<PurchaseOrderStatus, 'secondary' | 'warning' | 'success'> = {
  ORDERED: 'secondary',
  PARTIAL: 'warning',
  DELIVERED: 'success',
};

export default function PurchaseOrdersPage() {
  const t = useTranslations('procurement');
  const router = useRouter();
  const [status, setStatus] = useState<PurchaseOrderStatus | undefined>(undefined);
  const [offset, setOffset] = useState(0);

  const { data, isLoading } = usePurchaseOrders({ status, limit: PAGE_SIZE, offset });

  const columns = useMemo<ColumnDef<PurchaseOrder>[]>(
    () => [
      { accessorKey: 'supplierNameSnapshot', header: t('supplier') },
      {
        accessorKey: 'status',
        header: t('status'),
        cell: ({ getValue }) => {
          const s = getValue() as PurchaseOrderStatus;
          return <Badge variant={STATUS_VARIANT[s]}>{t(`poStatus${s}`)}</Badge>;
        },
      },
      {
        accessorKey: 'orderDate',
        header: t('orderDate'),
        cell: ({ getValue }) => new Date(getValue() as string).toLocaleDateString(),
      },
      {
        accessorKey: 'expectedDeliveryDate',
        header: t('expectedDeliveryDate'),
        cell: ({ getValue }) => (getValue() ? new Date(getValue() as string).toLocaleDateString() : '—'),
      },
    ],
    [t],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select value={status ?? '__all'} onValueChange={(v) => { setStatus(v === '__all' ? undefined : (v as PurchaseOrderStatus)); setOffset(0); }}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder={t('filterByStatus')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">{t('allStatuses')}</SelectItem>
            <SelectItem value="ORDERED">{t('poStatusORDERED')}</SelectItem>
            <SelectItem value="PARTIAL">{t('poStatusPARTIAL')}</SelectItem>
            <SelectItem value="DELIVERED">{t('poStatusDELIVERED')}</SelectItem>
          </SelectContent>
        </Select>
        <Button asChild>
          <Link href="/procurement/new">
            <Plus className="mr-2 h-4 w-4" />
            {t('newPurchaseOrder')}
          </Link>
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        onRowClick={(po) => router.push(`/procurement/${po.id}`)}
        pagination={data ? { offset, limit: PAGE_SIZE, total: data.total, onOffsetChange: setOffset } : undefined}
      />
    </div>
  );
}
