'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { useCustomerOrders } from '@/lib/hooks/use-sales';
import type { CustomerOrder, CustomerOrderStatus } from '@/lib/api-client/sales';
import { DataTable } from '@/components/domain/data-table/data-table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

const PAGE_SIZE = 50;

const STATUS_VARIANT: Record<CustomerOrderStatus, 'secondary' | 'warning' | 'success' | 'destructive'> = {
  NEW: 'secondary',
  IN_PRODUCTION: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'destructive',
};

export default function CustomerOrdersPage() {
  const t = useTranslations('sales');
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<CustomerOrderStatus | undefined>(undefined);
  const [offset, setOffset] = useState(0);

  const { data, isLoading } = useCustomerOrders({ search: search || undefined, status, limit: PAGE_SIZE, offset });

  const columns = useMemo<ColumnDef<CustomerOrder>[]>(
    () => [
      { accessorKey: 'clientName', header: t('clientName') },
      { accessorKey: 'orderNumber', header: t('orderNumber'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      {
        accessorKey: 'priority',
        header: t('priority'),
        cell: ({ getValue }) => t(`priority${getValue()}`),
      },
      {
        accessorKey: 'status',
        header: t('status'),
        cell: ({ getValue }) => {
          const s = getValue() as CustomerOrderStatus;
          return <Badge variant={STATUS_VARIANT[s]}>{t(`orderStatus${s}`)}</Badge>;
        },
      },
      {
        accessorKey: 'deadline',
        header: t('deadline'),
        cell: ({ getValue }) => (getValue() ? new Date(getValue() as string).toLocaleDateString() : '—'),
      },
      {
        accessorKey: 'estimatedTotal',
        header: t('estimatedTotal'),
        cell: ({ getValue }) => {
          const v = getValue() as number | null | undefined;
          return v != null ? v.toFixed(2) : t('pricePending');
        },
      },
      {
        accessorKey: 'actualTotal',
        header: t('actualTotal'),
        cell: ({ getValue }) => {
          const v = getValue() as number | null | undefined;
          return v != null ? v.toFixed(2) : t('pricePending');
        },
      },
    ],
    [t],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
            className="max-w-sm"
          />
          <Select value={status ?? '__all'} onValueChange={(v) => { setStatus(v === '__all' ? undefined : (v as CustomerOrderStatus)); setOffset(0); }}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder={t('filterByStatus')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">{t('allStatuses')}</SelectItem>
              <SelectItem value="NEW">{t('orderStatusNEW')}</SelectItem>
              <SelectItem value="IN_PRODUCTION">{t('orderStatusIN_PRODUCTION')}</SelectItem>
              <SelectItem value="COMPLETED">{t('orderStatusCOMPLETED')}</SelectItem>
              <SelectItem value="CANCELLED">{t('orderStatusCANCELLED')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button asChild>
          <Link href="/sales/new">
            <Plus className="mr-2 h-4 w-4" />
            {t('newOrder')}
          </Link>
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        onRowClick={(order) => router.push(`/sales/${order.id}`)}
        pagination={data ? { offset, limit: PAGE_SIZE, total: data.total, onOffsetChange: setOffset } : undefined}
      />
    </div>
  );
}
