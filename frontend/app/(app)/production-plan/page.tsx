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
 * "План виробництва" (2026-08-30 user request) — own top-level sidebar
 * module, not a tab inside Виробництво (moved out of production/by-order
 * after the user pointed out it belonged in the left nav, not buried in
 * Production's own tab strip). Every customer order with its production
 * completion % (server-aggregated — see CustomerOrdersService#
 * withProductionProgress), plus the same per-order Gantt the dashboard and
 * Планер already use, retargeted to open this module's own detail page.
 */
export default function ProductionPlanPage() {
  const t = useTranslations('productionPlan');
  const ts = useTranslations('sales');
  const tp = useTranslations('production');
  const router = useRouter();
  const [status, setStatus] = useState<CustomerOrderStatus | undefined>(undefined);
  const [offset, setOffset] = useState(0);
  const [year, setYear] = useState(new Date().getFullYear());

  const { data, isLoading } = useCustomerOrders({ status, limit: PAGE_SIZE, offset });

  const from = useMemo(() => new Date(year, 0, 1).toISOString(), [year]);
  const to = useMemo(() => new Date(year, 11, 31, 23, 59, 59).toISOString(), [year]);
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
      <h1 className="text-xl font-semibold">{t('title')}</h1>

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
        onRowClick={(order) => router.push(`/production-plan/${order.id}`)}
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
              getHref={(order) => `/production-plan/${order.id}`}
            />
          </div>
        </div>
      )}
    </div>
  );
}
