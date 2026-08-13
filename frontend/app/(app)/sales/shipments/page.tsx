'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { useShipments } from '@/lib/hooks/use-sales';
import type { Shipment, ShipmentStatus } from '@/lib/api-client/sales';
import { DataTable } from '@/components/domain/data-table/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

const PAGE_SIZE = 50;

const STATUS_VARIANT: Record<ShipmentStatus, 'secondary' | 'success'> = {
  SHIPPED: 'secondary',
  DELIVERED: 'success',
};

export default function ShipmentsPage() {
  const t = useTranslations('sales');
  const router = useRouter();
  const [status, setStatus] = useState<ShipmentStatus | undefined>(undefined);
  const [offset, setOffset] = useState(0);

  const { data, isLoading } = useShipments({ status, limit: PAGE_SIZE, offset });

  const columns = useMemo<ColumnDef<Shipment>[]>(
    () => [
      { accessorKey: 'carrier', header: t('carrier'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      { accessorKey: 'waybillNumber', header: t('waybillNumber'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      {
        accessorKey: 'status',
        header: t('status'),
        cell: ({ getValue }) => {
          const s = getValue() as ShipmentStatus;
          return <Badge variant={STATUS_VARIANT[s]}>{t(`shipmentStatus${s}`)}</Badge>;
        },
      },
      {
        accessorKey: 'shipDate',
        header: t('shipDate'),
        cell: ({ getValue }) => (getValue() ? new Date(getValue() as string).toLocaleDateString() : '—'),
      },
    ],
    [t],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select value={status ?? '__all'} onValueChange={(v) => { setStatus(v === '__all' ? undefined : (v as ShipmentStatus)); setOffset(0); }}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder={t('filterByStatus')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">{t('allStatuses')}</SelectItem>
            <SelectItem value="SHIPPED">{t('shipmentStatusSHIPPED')}</SelectItem>
            <SelectItem value="DELIVERED">{t('shipmentStatusDELIVERED')}</SelectItem>
          </SelectContent>
        </Select>
        <Button asChild>
          <Link href="/sales/shipments/new" data-tour="shipments-new-button">
            <Plus className="mr-2 h-4 w-4" />
            {t('newShipment')}
          </Link>
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        onRowClick={(shipment) => router.push(`/sales/shipments/${shipment.id}`)}
        pagination={data ? { offset, limit: PAGE_SIZE, total: data.total, onOffsetChange: setOffset } : undefined}
      />
    </div>
  );
}
