'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { CalendarRange } from 'lucide-react';
import { useCustomerOrders } from '@/lib/hooks/use-sales';
import { usePlannerBoard } from '@/lib/hooks/use-planner';
import type { CustomerOrder, CustomerOrderStatus } from '@/lib/api-client/sales';
import { DataTable } from '@/components/domain/data-table/data-table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { PlannerOrdersTimelineView } from '@/components/domain/planner/planner-orders-timeline';

const PAGE_SIZE = 50;

/** Small inline percent-complete bar — no shared Progress primitive exists in components/ui/ yet, and this is the only place that needs one so far. */
function ProgressCell({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <span className="text-sm text-muted-foreground">—</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
        <div
          className={value >= 100 ? 'h-full rounded-full bg-success' : 'h-full rounded-full bg-primary'}
          style={{ width: `${Math.max(value, 2)}%` }}
        />
      </div>
      <span className="w-9 shrink-0 text-right text-sm tabular-nums">{value}%</span>
    </div>
  );
}

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
  const tp = useTranslations('production');
  const tPlanner = useTranslations('planner');
  const router = useRouter();
  const [status, setStatus] = useState<CustomerOrderStatus | undefined>(undefined);
  const [offset, setOffset] = useState(0);
  const [year, setYear] = useState(new Date().getFullYear());

  const { data, isLoading } = useCustomerOrders({ status, limit: PAGE_SIZE, offset });

  const from = useMemo(() => new Date(year, 0, 1).toISOString(), [year]);
  const to = useMemo(() => new Date(year, 11, 31, 23, 59, 59).toISOString(), [year]);
  // "нище графік по замовленнях" (2026-08-30 user request) — reuses the
  // dashboard's own per-order Gantt (PlannerOrdersTimelineView/
  // usePlannerBoard) rather than building a second, cruder chart; only the
  // row-label click target changes (this module's own detail page, not Sales).
  const { data: board } = usePlannerBoard({ from, to });

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
      {
        accessorKey: 'percentComplete',
        header: tp('percentComplete'),
        cell: ({ getValue }) => <ProgressCell value={getValue() as number | null | undefined} />,
      },
    ],
    [ts, tp],
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

      {board && board.orders.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="flex items-center gap-2.5 border-b border-border bg-muted/40 px-3 py-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
              <CalendarRange className="h-4 w-4" />
            </span>
            <h3 className="text-sm font-semibold">{tp('scheduleByOrders')}</h3>
            <Badge variant="outline" className="ml-auto">
              {board.orders.length}
            </Badge>
          </div>
          <div className="p-3">
            <PlannerOrdersTimelineView
              orders={board.orders}
              year={year}
              onYearChange={setYear}
              getHref={(order) => `/production/by-order/${order.id}`}
            />
          </div>
        </div>
      )}
    </div>
  );
}
