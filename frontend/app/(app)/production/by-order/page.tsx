'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { useCustomerOrders } from '@/lib/hooks/use-sales';
import type { CustomerOrder, CustomerOrderStatus } from '@/lib/api-client/sales';
import { DataTable } from '@/components/domain/data-table/data-table';
import { Badge } from '@/components/ui/badge';

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
 * pick an order that's actually IN_PRODUCTION and open its FULL production
 * tree (every item, every sub-assembly at any depth) in one place, instead
 * of hunting down individual batches.
 */
export default function ProductionByOrderPage() {
  const ts = useTranslations('sales');
  const router = useRouter();
  const [offset, setOffset] = useState(0);

  const { data, isLoading } = useCustomerOrders({ status: 'IN_PRODUCTION', limit: PAGE_SIZE, offset });

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
