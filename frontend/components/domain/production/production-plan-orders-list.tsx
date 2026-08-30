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
import { PlannerOrdersPrintTable, PlannerOrdersPrintLegend } from '@/components/domain/planner/planner-orders-print';
import { PrintArea, PrintDocumentHeader, PrintButton, PreviewButton } from '@/components/domain/print/print-area';

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
 * Every customer order with its production completion % (server-aggregated
 * — CustomerOrdersService#withProductionProgress), plus the per-order Gantt
 * the dashboard/Планер already use, retargeted per `basePath`. Shared
 * (2026-08-30) between "План виробництва" (own top-level sidebar module)
 * and Виробництво → "По замовленнях" (restored per user request — both
 * entry points to the exact same list/detail pages, `title` optional since
 * only the standalone module needs its own heading; Виробництво's own
 * layout already renders one).
 */
export function ProductionPlanOrdersList({ basePath, title }: { basePath: string; title?: string }) {
  const ts = useTranslations('sales');
  const tp = useTranslations('production');
  const tPlanner = useTranslations('planner');
  const tPrint = useTranslations('print');
  const router = useRouter();
  const [status, setStatus] = useState<CustomerOrderStatus | undefined>(undefined);
  const [offset, setOffset] = useState(0);
  const [year, setYear] = useState(new Date().getFullYear());

  const { data, isLoading } = useCustomerOrders({ status, limit: PAGE_SIZE, offset });

  const yearStart = useMemo(() => new Date(year, 0, 1), [year]);
  const yearEnd = useMemo(() => new Date(year, 11, 31, 23, 59, 59), [year]);
  const { data: board } = usePlannerBoard({ from: yearStart.toISOString(), to: yearEnd.toISOString() });

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
      {title && <h1 className="text-xl font-semibold">{title}</h1>}

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
        onRowClick={(order) => router.push(`${basePath}/${order.id}`)}
        pagination={data ? { offset, limit: PAGE_SIZE, total: data.total, onOffsetChange: setOffset } : undefined}
      />

      {board && board.orders.length > 0 && (
        <>
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="flex flex-wrap items-center gap-2.5 border-b border-border bg-muted/40 px-3 py-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                <CalendarRange className="h-4 w-4" />
              </span>
              <h3 className="text-sm font-semibold">{tp('scheduleByOrders')}</h3>
              <Badge variant="outline">{board.orders.length}</Badge>
              <div className="ml-auto flex items-center gap-2">
                <PrintButton label={tPrint('printAction')} />
                <PreviewButton />
              </div>
            </div>
            <div className="p-3">
              <PlannerOrdersTimelineView
                orders={board.orders}
                year={year}
                onYearChange={setYear}
                getHref={(order) => `${basePath}/${order.id}`}
              />
            </div>
          </div>

          <PrintArea>
            {/* Landscape — same as Планер's own "По замовленнях" print (this table is a wide month-by-month calendar, cramped in portrait). */}
            <style>{`@page { size: landscape; margin: 10mm; }`}</style>
            <PrintDocumentHeader title={tp('scheduleByOrders')} subtitle={String(year)} />
            <PlannerOrdersPrintTable orders={board.orders} from={yearStart} to={yearEnd} scale="year" />
            <div className="mt-4">
              <strong className="text-[9px]">{tPlanner('legendTitle')}:</strong>
              <div className="mt-1">
                <PlannerOrdersPrintLegend />
              </div>
            </div>
          </PrintArea>
        </>
      )}
    </div>
  );
}
