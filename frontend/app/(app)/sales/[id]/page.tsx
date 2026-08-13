'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LoadingBlock } from '@/components/ui/loading-block';
import {
  useCustomerOrder,
  useCancelCustomerOrder,
  useCompleteCustomerOrder,
  useGiveItemToProduction,
  useGiveAllToProduction,
} from '@/lib/hooks/use-sales';
import { useAssembly, useAssemblyCost, useAssemblyCosts } from '@/lib/hooks/use-bom';
import { useProductionOrder, useProductionOrdersByIds } from '@/lib/hooks/use-production';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { formatEur } from '@/lib/utils';
import { ApiError } from '@/lib/api-client/types';
import type { CustomerOrderItem, CustomerOrderStatus } from '@/lib/api-client/sales';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
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

/** CustomerOrderItem only carries a raw assemblyId — resolve to a real name/photo, same fix as the print view and other order lists. */
function AssemblyCell({ assemblyId }: { assemblyId: string }) {
  const { data: assembly } = useAssembly(assemblyId);
  const { data: photosByAssembly } = useFilesForEntities('Assembly', [assemblyId], 'ASSEMBLY_PHOTO');
  return (
    <div className="flex items-center gap-2.5">
      <Avatar src={photosByAssembly?.[assemblyId]?.[0]?.downloadUrl} size="sm" />
      <span className="max-w-[320px] truncate" title={assembly?.name ?? assemblyId}>
        {assembly ? `${assembly.name}${assembly.article ? ` (${assembly.article})` : ''}` : assemblyId}
      </span>
    </div>
  );
}

/** Live BOM cost × qty — recomputed fresh every load, same "never frozen" estimate the creation form (sales/new) already shows, since nothing about this line is frozen until its production order actually starts. */
function EstimatedPriceCell({ assemblyId, qty }: { assemblyId: string; qty: number }) {
  const t = useTranslations('sales');
  const { data: cost } = useAssemblyCost(assemblyId);
  return <TableCell className="text-muted-foreground">{cost ? formatEur(cost.costPerUnit * qty) : t('pricePending')}</TableCell>;
}

/**
 * The linked ProductionOrder's `totalLocalCostEur` — frozen the moment
 * production actually started (real components consumed then, sellPriceEur
 * at that moment), which is the only "what did this really cost" signal
 * this app has today. Stays "ще не визначено" until the line has been
 * given to production AND that order has been started — advancing through
 * production stages afterward doesn't change it (see
 * production-orders.service.ts: cost is frozen once at start(), never
 * recomputed at stage-advance or completion).
 */
function ActualPriceCell({ productionOrderId }: { productionOrderId: string | null }) {
  const t = useTranslations('sales');
  const { data: po } = useProductionOrder(productionOrderId ?? undefined);
  if (!productionOrderId || !po || po.totalLocalCostEur == null) {
    return <TableCell className="text-muted-foreground">{t('pricePending')}</TableCell>;
  }
  return <TableCell>{formatEur(Number(po.totalLocalCostEur))}</TableCell>;
}

/** Order-level estimated/actual totals, batched — see EstimatedPriceCell/ActualPriceCell for what each is. */
function OrderPriceTotals({ items }: { items: CustomerOrderItem[] }) {
  const t = useTranslations('sales');
  const costResults = useAssemblyCosts(items.map((i) => i.assemblyId));
  const poResults = useProductionOrdersByIds(items.map((i) => i.productionOrderId ?? undefined));

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
  items.forEach((item, i) => {
    const po = poResults[i]?.data;
    if (po?.totalLocalCostEur != null) {
      actualTotal += Number(po.totalLocalCostEur);
      hasActual = true;
    }
  });

  return (
    <div className="flex gap-6">
      <div>
        <p className="text-xs text-muted-foreground">{t('estimatedTotal')}</p>
        <p className="text-sm font-medium">{hasEstimate ? formatEur(estimatedTotal) : t('pricePending')}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{t('actualTotal')}</p>
        <p className="text-sm font-medium">{hasActual ? formatEur(actualTotal) : t('pricePending')}</p>
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

export default function CustomerOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const t = useTranslations('sales');
  const tc = useTranslations('common');

  const { data: order, isLoading } = useCustomerOrder(params.id);
  const cancelOrder = useCancelCustomerOrder(params.id);
  const completeOrder = useCompleteCustomerOrder(params.id);
  const giveItem = useGiveItemToProduction(params.id);
  const giveAll = useGiveAllToProduction(params.id);

  const [error, setError] = useState<string | null>(null);

  if (isLoading || !order) {
    return <LoadingBlock />;
  }

  const canCancel = order.status === 'NEW' || order.status === 'IN_PRODUCTION';
  const canComplete = order.status !== 'COMPLETED' && order.status !== 'CANCELLED';
  const hasUngivenLines = (order.items ?? []).some((item) => !item.productionOrderId);

  async function handleCancel() {
    setError(null);
    try {
      await cancelOrder.mutateAsync();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  async function handleComplete() {
    setError(null);
    try {
      await completeOrder.mutateAsync();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  async function handleGiveItem(itemId: string) {
    setError(null);
    try {
      await giveItem.mutateAsync({ itemId });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  async function handleGiveAll() {
    setError(null);
    try {
      await giveAll.mutateAsync();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">{order.clientName}</h2>
          <Badge variant={STATUS_VARIANT[order.status]}>{t(`orderStatus${order.status}`)}</Badge>
        </div>
        <div className="flex gap-2">
          <CustomerOrderPrint order={order} />
          <Button asChild variant="outline" size="sm">
            <Link href={`/sales/${order.id}/shortage`}>{t('shortagePreview')}</Link>
          </Button>
          {canComplete && (
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
          {canCancel && (
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
          {order.comment && (
            <div className="col-span-full">
              <p className="text-xs text-muted-foreground">{t('comment')}</p>
              <p className="text-sm">{order.comment}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">{t('items')}</CardTitle>
          <div className="flex items-center gap-6">
            {order.items && order.items.length > 0 && <OrderPriceTotals items={order.items} />}
            {hasUngivenLines && (
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
                <TableHead>{t('productionStatus')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(order.items ?? []).map((item) => (
                <TableRow key={item.id}>
                  <TableCell><AssemblyCell assemblyId={item.assemblyId} /></TableCell>
                  <TableCell>{item.qty}</TableCell>
                  <EstimatedPriceCell assemblyId={item.assemblyId} qty={Number(item.qty)} />
                  <ActualPriceCell productionOrderId={item.productionOrderId} />
                  <TableCell>
                    {item.productionOrderId ? (
                      <Link href={`/production/${item.productionOrderId}`} className="text-primary hover:underline">
                        {t('viewProductionOrder')}
                      </Link>
                    ) : (
                      <Button size="sm" variant="outline" loading={giveItem.isPending} onClick={() => handleGiveItem(item.id)}>
                        {t('giveToProduction')}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
