'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { useCustomerOrders } from '@/lib/hooks/use-sales';
import type { CustomerOrder, CustomerOrderStatus } from '@/lib/api-client/sales';
import { DataTable } from '@/components/domain/data-table/data-table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

const PAGE_SIZE = 50;

const STATUS_VARIANT: Record<CustomerOrderStatus, 'secondary' | 'warning' | 'success' | 'destructive'> = {
  NEW: 'secondary',
  IN_PRODUCTION: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'destructive',
};

/**
 * "По замовленнях" (2026-08-27 user request) — the rest of the Production
 * module is one flat list of batches (ProductionOrder) with no notion of
 * "which customer order is this for". This tab groups the other direction:
 * pick an order and open its FULL production tree (every item, every
 * sub-assembly at any depth) in one place, instead of hunting down
 * individual batches. Defaults to showing every status (not just
 * IN_PRODUCTION) — since sub-assembly production is no longer planned
 * automatically at order creation, a freshly created order can sit on
 * NEW with a fully drawable production tree and nothing given to
 * production yet; staff need to reach that tree from here too, not only
 * once something has already been started.
 */
export default function ProductionByOrderPage() {
  const ts = useTranslations('sales');
  const router = useRouter();
  const [status, setStatus] = useState<CustomerOrderStatus | undefined>(undefined);
  const [offset, setOffset] = useState(0);

  const { data, isLoading } = useCustomerOrders({ status, limit: PAGE_SIZE, offset });

  const columns = useMemo<ColumnDef<CustomerOrder>[]>(
    () => [
      { accessorKey: 'clientName', header: ts('clientName') },
      { accessorKey: 'orderNumber', header: ts('orderNumber'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      {
        accessorKey: 'status',
        header: ts('status'),
        cell: ({ getValue }) => {
          const s = getValue() as CustomerOrderStatus;
          return <Badge variant={STATUS_VARIANT[s]}>{ts(`orderStatus${s}`)}</Badge>;
        },
      },
      {
        accessorKey: 'deadline',
        header: ts('deadline'),
        cell: ({ getValue }) => (getValue() ? new Date(getValue() as string).toLocaleDateString() : '—'),
      },
    ],
    [ts],
  );

  return (
    <div className="space-y-4">
      <Select value={status ?? '__all'} onValueChange={(v) => { setStatus(v === '__all' ? undefined : (v as CustomerOrderStatus)); setOffset(0); }}>
        <SelectTrigger className="w-48">
          <SelectValue placeholder={ts('filterByStatus')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">{ts('allStatuses')}</SelectItem>
          <SelectItem value="NEW">{ts('orderStatusNEW')}</SelectItem>
          <SelectItem value="IN_PRODUCTION">{ts('orderStatusIN_PRODUCTION')}</SelectItem>
          <SelectItem value="COMPLETED">{ts('orderStatusCOMPLETED')}</SelectItem>
          <SelectItem value="CANCELLED">{ts('orderStatusCANCELLED')}</SelectItem>
        </SelectContent>
      </Select>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        onRowClick={(order) => router.push(`/production/by-order/${order.id}`)}
        pagination={data ? { offset, limit: PAGE_SIZE, total: data.total, onOffsetChange: setOffset } : undefined}
      />
    </div>
  );
}
