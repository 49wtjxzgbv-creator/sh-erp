'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LoadingBlock } from '@/components/ui/loading-block';
import {
  useCustomerOrder,
  useCancelCustomerOrder,
  useCompleteCustomerOrder,
  useDeleteCustomerOrder,
  useGiveItemToProduction,
  useGiveAllToProduction,
} from '@/lib/hooks/use-sales';
import { useAssemblyCost, useAssemblyCosts } from '@/lib/hooks/use-bom';
import { useProductionOrdersByIds } from '@/lib/hooks/use-production';
import { formatEur, toDatetimeLocalValue, fromDatetimeLocalValue } from '@/lib/utils';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { toNumber } from '@/lib/api-client/decimal';
import type { CustomerOrder, CustomerOrderItem, CustomerOrderStatus } from '@/lib/api-client/sales';
import type { ProductionOrderStatus } from '@/lib/api-client/production';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { CustomerOrderPrint } from '@/components/domain/sales/customer-order-print';
import { EditCustomerOrderDialog } from '@/components/domain/sales/edit-customer-order-dialog';
import { ProductionProgressTree } from '@/components/domain/sales/production-progress-tree';
import { ProductionProgressPrint } from '@/components/domain/sales/production-progress-print';
import { AssemblyCell } from '@/components/domain/sales/assembly-cell';
import { FinanceSummaryWidget } from '@/components/domain/sales/finance-summary-widget';
import { PayrollFundWidget } from '@/components/domain/sales/payroll-fund-widget';
import { CollapsibleCard } from '@/components/domain/sales/collapsible-card';
import { EntityDocumentsField } from '@/components/domain/files/entity-documents-field';
import { useHasPermission } from '@/lib/hooks/use-roles';

/** Live BOM cost × qty — recomputed fresh every load, same "never frozen" estimate the creation form (sales/new) already shows, since nothing about this line is frozen until its production order actually starts. */
function EstimatedPriceCell({ assemblyId, qty }: { assemblyId: string; qty: number }) {
  const t = useTranslations('sales');
  const { data: cost } = useAssemblyCost(assemblyId);
  return <TableCell className="text-muted-foreground">{cost ? formatEur(cost.costPerUnit * qty) : t('pricePending')}</TableCell>;
}

/**
 * Sum of `totalLocalCostEur` across every batch (ProductionOrder) behind
 * this line — a line can have several once split (План-графік §1), unlike
 * the old single linked order this replaces. Frozen the moment each batch
 * actually started; a batch that hasn't started yet contributes nothing
 * (production-orders.service.ts: cost is frozen once at start(), never
 * recomputed at stage-advance or completion).
 */
function ActualPriceCell({ batchIds }: { batchIds: string[] }) {
  const t = useTranslations('sales');
  const poResults = useProductionOrdersByIds(batchIds);
  let total = 0;
  let hasActual = false;
  for (const r of poResults) {
    if (r.data?.totalLocalCostEur != null) {
      total += Number(r.data.totalLocalCostEur);
      hasActual = true;
    }
  }
  if (!hasActual) return <TableCell className="text-muted-foreground">{t('pricePending')}</TableCell>;
  return <TableCell>{formatEur(total)}</TableCell>;
}

/** Order-level estimated/actual totals, batched — see EstimatedPriceCell/ActualPriceCell for what each is. */
function OrderPriceTotals({ order, items }: { order: CustomerOrder; items: CustomerOrderItem[] }) {
  const t = useTranslations('sales');
  const costResults = useAssemblyCosts(items.map((i) => i.assemblyId));
  const allBatchIds = items.flatMap((i) => i.quantitySummary?.batches.map((b) => b.id) ?? []);
  const poResults = useProductionOrdersByIds(allBatchIds);

  let estimatedTotal = 0;
  let hasEstimate = false;
  items.forEach((item, i) => {
    const cost = costResults[i]?.data;
    if (cost) {
      estimatedTotal += cost.costPerUnit * Number(item.qty);
      hasEstimate = true;
    }
  });

  let actualTotal = 0;
  let hasActual = false;
  for (const r of poResults) {
    if (r.data?.totalLocalCostEur != null) {
      actualTotal += Number(r.data.totalLocalCostEur);
      hasActual = true;
    }
  }

  // Delivery/transport-rigging/other — entered directly, not BOM-derived —
  // count toward both totals, same fold as CustomerOrdersService's own
  // withPriceTotals (list view); this detail view computes its own totals
  // independently (findOne doesn't pre-aggregate them), so the same logic
  // is duplicated here rather than trusting a server-computed field.
  const extraCostValues = [toNumber(order.deliveryCost), toNumber(order.transportRiggingCost), toNumber(order.otherCost)];
  const extraCostsTotal = extraCostValues.reduce((sum: number, v) => sum + (v ?? 0), 0);
  const hasExtraCosts = extraCostValues.some((v) => v != null);
  if (hasExtraCosts) {
    estimatedTotal += extraCostsTotal;
    hasEstimate = true;
    actualTotal += extraCostsTotal;
    hasActual = true;
  }

  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2">
      <div>
        <p className="text-xs text-muted-foreground">{t('estimatedTotal')}</p>
        <p className="text-sm font-medium">{hasEstimate ? formatEur(estimatedTotal) : t('pricePending')}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{t('actualTotal')}</p>
        <p className="text-sm font-medium">{hasActual ? formatEur(actualTotal) : t('pricePending')}</p>
        <p className="text-[11px] text-muted-foreground">{t('actualTotalHint')}</p>
      </div>
    </div>
  );
}

const STATUS_VARIANT: Record<CustomerOrderStatus, 'secondary' | 'warning' | 'success' | 'destructive'> = {
  NEW: 'secondary',
  IN_PRODUCTION: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'destructive',
};

const BATCH_STATUS_VARIANT: Record<ProductionOrderStatus, 'secondary' | 'warning' | 'success' | 'destructive'> = {
  PLANNED: 'secondary',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'destructive',
};

function formatPlannedDate(iso: string | null | undefined, notPlannedLabel: string): string {
  return iso ? new Date(iso).toLocaleString() : notPlannedLabel;
}

/**
 * Batch-splitting entry point (План-графік §1) — every call creates a new,
 * independent ProductionOrder batch as long as `remaining` > 0; qty/dates
 * are this batch's own, never shared with any other batch on the line.
 */
function GiveToProductionDialog({
  itemId,
  remaining,
  onSubmit,
  pending,
}: {
  itemId: string;
  remaining: number;
  onSubmit: (itemId: string, dto: { unitsPlanned?: number; scheduledStartAt?: string; scheduledEndAt?: string }) => Promise<void>;
  pending: boolean;
}) {
  const t = useTranslations('sales');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(String(Math.ceil(remaining)));
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSubmit() {
    setLocalError(null);
    const parsedQty = qty ? Number(qty) : undefined;
    if (parsedQty != null && (!Number.isInteger(parsedQty) || parsedQty <= 0 || parsedQty > remaining + 1e-6)) {
      setLocalError(t('invalidGiveToProduction'));
      return;
    }
    await onSubmit(itemId, {
      unitsPlanned: parsedQty,
      scheduledStartAt: fromDatetimeLocalValue(start),
      scheduledEndAt: fromDatetimeLocalValue(end),
    });
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) { setQty(String(Math.ceil(remaining))); setStart(''); setEnd(''); setLocalError(null); } }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          {t('giveToProduction')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('giveToProductionDialogTitle')}</DialogTitle>
          <DialogDescription>{t('giveToProductionDialogDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="batchQty">{t('batchQty')} ({t('remainingQty')}: {remaining})</Label>
            <Input id="batchQty" type="number" step="1" min={1} max={remaining} value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="batchStart">{t('batchScheduledStartAt')}</Label>
            <Input id="batchStart" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="batchEnd">{t('batchScheduledEndAt')}</Label>
            <Input id="batchEnd" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
          {localError && <p className="text-sm text-destructive">{localError}</p>}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{tc('cancel')}</Button>
          </DialogClose>
          <Button loading={pending} onClick={handleSubmit}>
            {tc('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Quantity summary + one row per batch (План-графік §1) — never a single link like the old 1:1 model. */
function ItemBatchesCell({ item }: { item: CustomerOrderItem }) {
  const t = useTranslations('sales');
  const tp = useTranslations('production');
  const summary = item.quantitySummary;
  if (!summary) return <TableCell>—</TableCell>;
  return (
    <TableCell>
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>{t('ordered')}: {summary.ordered} · {t('inProductionQty')}: {summary.inProduction} · {t('completedQty')}: {summary.completed}</p>
        {summary.batches.length > 0 && (
          <ul className="space-y-0.5">
            {summary.batches.map((b) => (
              <li key={b.id}>
                <Link href={`/production/${b.id}`} className="text-primary hover:underline">
                  {t('batch')} · {b.unitsPlanned}
                </Link>{' '}
                <Badge variant={BATCH_STATUS_VARIANT[b.status]} className="ml-1">
                  {tp(`status${b.status}`)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </TableCell>
  );
}

export default function CustomerOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('sales');
  const tc = useTranslations('common');
  const tf = useTranslations('files');
  const apiErrorMessage = useApiErrorMessage();

  const { data: order, isLoading } = useCustomerOrder(params.id);
  const cancelOrder = useCancelCustomerOrder(params.id);
  const completeOrder = useCompleteCustomerOrder(params.id);
  const deleteOrder = useDeleteCustomerOrder();
  const giveItem = useGiveItemToProduction(params.id);
  const giveAll = useGiveAllToProduction(params.id);
  const canManage = useHasPermission('customer-orders:manage');
  const canDelete = useHasPermission('customer-orders:delete');

  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  if (isLoading || !order) {
    return <LoadingBlock />;
  }

  const canCancel = order.status === 'NEW' || order.status === 'IN_PRODUCTION';
  const canComplete = order.status !== 'COMPLETED' && order.status !== 'CANCELLED';
  const hasUngivenLines = (order.items ?? []).some((item) => (item.quantitySummary?.remaining ?? 0) > 0);

  async function handleCancel() {
    setError(null);
    try {
      await cancelOrder.mutateAsync();
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleComplete() {
    setError(null);
    try {
      await completeOrder.mutateAsync();
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleDelete() {
    setError(null);
    try {
      await deleteOrder.mutateAsync(params.id);
      router.replace('/sales');
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleGiveItem(itemId: string, dto: { unitsPlanned?: number; scheduledStartAt?: string; scheduledEndAt?: string }) {
    setError(null);
    try {
      await giveItem.mutateAsync({ itemId, dto });
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
      throw err;
    }
  }

  async function handleGiveAll() {
    setError(null);
    try {
      await giveAll.mutateAsync();
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">{order.clientName}</h2>
          <Badge variant={STATUS_VARIANT[order.status]}>{t(`orderStatus${order.status}`)}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && (
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              {t('editOrder')}
            </Button>
          )}
          <CustomerOrderPrint order={order} />
          {canManage && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/sales/${order.id}/shortage`}>{t('shortagePreview')}</Link>
            </Button>
          )}
          {canComplete && canManage && (
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  {t('completeOrder')}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('completeConfirmTitle')}</DialogTitle>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">{tc('cancel')}</Button>
                  </DialogClose>
                  <Button loading={completeOrder.isPending} onClick={handleComplete}>
                    {tc('confirm')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          {canCancel && canManage && (
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  {t('cancelOrder')}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('cancelConfirmTitle')}</DialogTitle>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">{tc('cancel')}</Button>
                  </DialogClose>
                  <Button variant="destructive" loading={cancelOrder.isPending} onClick={handleCancel}>
                    {tc('confirm')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          {canDelete && (
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  {t('deleteOrderPermanently')}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('deleteOrderConfirmTitle')}</DialogTitle>
                  <DialogDescription>{t('deleteOrderConfirmDescription')}</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">{tc('cancel')}</Button>
                  </DialogClose>
                  <Button variant="destructive" loading={deleteOrder.isPending} onClick={handleDelete}>
                    {tc('delete')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">{t('orderNumber')}</p>
            <p className="text-sm">{order.orderNumber ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('contactPerson')}</p>
            <p className="text-sm">{order.contactPerson ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('priority')}</p>
            <p className="text-sm">{t(`priority${order.priority}`)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('deadline')}</p>
            <p className="text-sm">{order.deadline ? new Date(order.deadline).toLocaleDateString() : '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('plannedStartAt')}</p>
            <p className="text-sm">{formatPlannedDate(order.plannedStartAt, t('notPlanned'))}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('plannedCompletionAt')}</p>
            <p className="text-sm">{formatPlannedDate(order.plannedCompletionAt, t('notPlanned'))}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('plannedShipmentAt')}</p>
            <p className="text-sm">{formatPlannedDate(order.plannedShipmentAt, t('notPlanned'))}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('plannedDeliveryAt')}</p>
            <p className="text-sm">{formatPlannedDate(order.plannedDeliveryAt, t('notPlanned'))}</p>
          </div>
          {toNumber(order.deliveryCost) != null && (
            <div>
              <p className="text-xs text-muted-foreground">{t('deliveryCost')}</p>
              <p className="text-sm">{formatEur(toNumber(order.deliveryCost)!)}</p>
            </div>
          )}
          {toNumber(order.transportRiggingCost) != null && (
            <div>
              <p className="text-xs text-muted-foreground">{t('transportRiggingCost')}</p>
              <p className="text-sm">{formatEur(toNumber(order.transportRiggingCost)!)}</p>
            </div>
          )}
          {toNumber(order.otherCost) != null && (
            <div>
              <p className="text-xs text-muted-foreground">{t('otherCost')}</p>
              <p className="text-sm">{formatEur(toNumber(order.otherCost)!)}</p>
            </div>
          )}
          {order.comment && (
            <div className="col-span-full">
              <p className="text-xs text-muted-foreground">{t('comment')}</p>
              <p className="text-sm">{order.comment}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <FinanceSummaryWidget customerOrderId={order.id} />
      <PayrollFundWidget orderId={order.id} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tf('documents')}</CardTitle>
        </CardHeader>
        <CardContent>
          <EntityDocumentsField domain="CUSTOMER_ORDER_DOCUMENT" entityType="CustomerOrder" entityId={order.id} accept="*/*" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">{t('items')}</CardTitle>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {order.items && order.items.length > 0 && <OrderPriceTotals order={order} items={order.items} />}
            {hasUngivenLines && canManage && (
              <Button size="sm" variant="outline" loading={giveAll.isPending} onClick={handleGiveAll}>
                {t('giveAllToProduction')}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('assembly')}</TableHead>
                <TableHead>{t('qty')}</TableHead>
                <TableHead>{t('estimatedPrice')}</TableHead>
                <TableHead>{t('actualPrice')}</TableHead>
                <TableHead>{t('productionBatches')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(order.items ?? []).map((item) => {
                const batchIds = item.quantitySummary?.batches.map((b) => b.id) ?? [];
                const remaining = item.quantitySummary?.remaining ?? 0;
                return (
                  <TableRow key={item.id}>
                    <TableCell><AssemblyCell assemblyId={item.assemblyId} /></TableCell>
                    <TableCell>{item.qty}</TableCell>
                    <EstimatedPriceCell assemblyId={item.assemblyId} qty={Number(item.qty)} />
                    <ActualPriceCell batchIds={batchIds} />
                    <ItemBatchesCell item={item} />
                    <TableCell>
                      {remaining > 0 && canManage && (
                        <GiveToProductionDialog itemId={item.id} remaining={remaining} onSubmit={handleGiveItem} pending={giveItem.isPending} />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CollapsibleCard
        title={t('productionProgress')}
        headerExtra={
          <div onClick={(e) => e.stopPropagation()}>
            <ProductionProgressPrint order={order} />
          </div>
        }
        contentClassName="space-y-6"
      >
        {(order.items ?? []).map((item) => (
          <div key={item.id} className="space-y-2">
            <div className="rounded-md border-2 border-primary/40 bg-primary/5 p-3">
              <AssemblyCell assemblyId={item.assemblyId} size="lg" textClassName="text-base font-semibold" />
            </div>
            <ProductionProgressTree orderId={order.id} itemId={item.id} />
          </div>
        ))}
      </CollapsibleCard>

      <EditCustomerOrderDialog open={editOpen} onOpenChange={setEditOpen} order={order} />
    </div>
  );
}
