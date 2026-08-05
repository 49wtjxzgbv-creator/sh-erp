'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LoadingBlock } from '@/components/ui/loading-block';
import {
  useProductionOrder,
  useProductionStages,
  useSetProductionOrderWorkers,
  useCancelProductionOrder,
  useStartProductionOrder,
  useAdvanceProductionOrderStage,
} from '@/lib/hooks/use-production';
import { useWarehouses } from '@/lib/hooks/use-inventory';
import { ApiError } from '@/lib/api-client/types';
import type { ProductionOrderStatus, FinishedGoodStatus } from '@/lib/api-client/production';
import { WorkerEditor, workersToRows, rowsToWorkers, type EditableWorkerRow } from '@/components/domain/production/worker-editor';
import { PickListPrint } from '@/components/domain/production/pick-list-print';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import Link from 'next/link';
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

const STATUS_VARIANT: Record<ProductionOrderStatus, 'secondary' | 'warning' | 'success' | 'destructive'> = {
  PLANNED: 'secondary',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'destructive',
};

const FG_STATUS_VARIANT: Record<FinishedGoodStatus, 'secondary' | 'warning' | 'success' | 'destructive'> = {
  IN_STOCK: 'success',
  SHIPPED: 'secondary',
  CONSUMED: 'secondary',
  REWORK: 'warning',
  DEFECTIVE: 'destructive',
};

export default function ProductionOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const t = useTranslations('production');
  const tc = useTranslations('common');

  const { data: order, isLoading } = useProductionOrder(params.id);
  const { data: stages } = useProductionStages();
  const { data: warehouses } = useWarehouses();

  const setWorkers = useSetProductionOrderWorkers(params.id);
  const cancelOrder = useCancelProductionOrder(params.id);
  const startOrder = useStartProductionOrder(params.id);
  const advanceStage = useAdvanceProductionOrderStage(params.id);

  const [workerRows, setWorkerRows] = useState<EditableWorkerRow[]>([]);
  const workersHydrated = useRef(false);
  const [workersError, setWorkersError] = useState<string | null>(null);
  const [warehouseId, setWarehouseId] = useState<string | undefined>(undefined);
  const [startError, setStartError] = useState<string | null>(null);
  const [advanceError, setAdvanceError] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  useEffect(() => {
    if (order?.workers && !workersHydrated.current) {
      workersHydrated.current = true;
      setWorkerRows(workersToRows(order.workers.map((w) => ({ employeeId: w.employeeId, percent: Number(w.percent) }))));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.workers]);

  if (isLoading || !order) {
    return <LoadingBlock />;
  }

  async function handleSaveWorkers() {
    setWorkersError(null);
    const workers = rowsToWorkers(workerRows);
    if (workers === null) {
      setWorkersError(t('invalidRow'));
      return;
    }
    try {
      await setWorkers.mutateAsync(workers);
    } catch (err) {
      setWorkersError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  async function handleCancel() {
    setCancelError(null);
    try {
      await cancelOrder.mutateAsync();
    } catch (err) {
      setCancelError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  async function handleStart() {
    setStartError(null);
    try {
      await startOrder.mutateAsync({ warehouseId });
    } catch (err) {
      setStartError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  async function handleAdvance() {
    setAdvanceError(null);
    try {
      await advanceStage.mutateAsync();
    } catch (err) {
      setAdvanceError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  const currentStageName =
    order.status === 'IN_PROGRESS' && order.currentStageIndex != null && stages
      ? stages[order.currentStageIndex]?.name
      : undefined;
  const isLastStage = stages && order.currentStageIndex != null && order.currentStageIndex >= stages.length - 1;

  const hasCosts = order.fullCostEur != null || order.totalLocalCostEur != null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">{t('orderHeader')}</h2>
          <Badge variant={STATUS_VARIANT[order.status]}>{t(`status${order.status}`)}</Badge>
        </div>
        {order.status === 'PLANNED' && (
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="destructive" size="sm">
                {t('cancelOrder')}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('cancelConfirmTitle')}</DialogTitle>
                <DialogDescription>{t('cancelConfirmDescription')}</DialogDescription>
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
      {cancelError && <p className="text-sm text-destructive">{cancelError}</p>}

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">{t('assembly')}</p>
            <p className="max-w-[200px] truncate text-sm" title={order.assemblyId}>{order.assemblyId}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('unitsPlanned')}</p>
            <p className="text-sm">{order.unitsPlanned}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('createdAt')}</p>
            <p className="text-sm">{new Date(order.createdAt).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('completedAt')}</p>
            <p className="text-sm">{order.completedAt ? new Date(order.completedAt).toLocaleString() : '—'}</p>
          </div>
          {order.comment && (
            <div className="col-span-full">
              <p className="text-xs text-muted-foreground">{t('comment')}</p>
              <p className="text-sm">{order.comment}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {order.status === 'IN_PROGRESS' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('stageTracker')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {stages?.map((stage, idx) => (
                <Badge key={stage.id} variant={idx === order.currentStageIndex ? 'warning' : idx < (order.currentStageIndex ?? 0) ? 'success' : 'outline'}>
                  {stage.name}
                </Badge>
              ))}
            </div>
            {currentStageName && <p className="text-sm text-muted-foreground">{t('currentStage')}: {currentStageName}</p>}
            <Button onClick={handleAdvance} loading={advanceStage.isPending}>
              {isLastStage ? t('completeOrder') : t('advanceStage')}
            </Button>
            {advanceError && <p className="text-sm text-destructive">{advanceError}</p>}
          </CardContent>
        </Card>
      )}

      {order.status === 'PLANNED' && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('workers')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <WorkerEditor rows={workerRows} onChange={setWorkerRows} />
              {workersError && <p className="text-sm text-destructive">{workersError}</p>}
              <Button variant="outline" onClick={handleSaveWorkers} loading={setWorkers.isPending}>
                {tc('save')}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('startOrder')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <p className="text-sm text-muted-foreground">{t('warehouseOptional')}</p>
                <Select value={warehouseId ?? '__default'} onValueChange={(v) => setWarehouseId(v === '__default' ? undefined : v)}>
                  <SelectTrigger className="w-64">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default">{t('defaultWarehouse')}</SelectItem>
                    {warehouses?.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Dialog>
                <DialogTrigger asChild>
                  <Button>{t('startOrder')}</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t('startConfirmTitle')}</DialogTitle>
                    <DialogDescription>{t('startConfirmDescription')}</DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button variant="outline">{tc('cancel')}</Button>
                    </DialogClose>
                    <Button loading={startOrder.isPending} onClick={handleStart}>
                      {t('startOrder')}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              {startError && <p className="text-sm text-destructive">{startError}</p>}
            </CardContent>
          </Card>
        </>
      )}

      {hasCosts && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('costBreakdown')}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">{t('laborCost')}</p>
              <p className="text-sm">{order.laborCostEur ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('packagingCost')}</p>
              <p className="text-sm">{order.packagingCostEur ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('deliveryCost')}</p>
              <p className="text-sm">{order.deliveryCostEur ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('otherCost')}</p>
              <p className="text-sm">{order.otherCostEur ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('localCost')}</p>
              <p className="text-sm">{order.totalLocalCostEur ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('germanCost')}</p>
              <p className="text-sm">{order.totalGermanCostEur ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('fullCost')}</p>
              <p className="text-sm">{order.fullCostEur ?? '—'}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {order.pickListItems && order.pickListItems.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">{t('pickList')}</CardTitle>
            <PickListPrint
              orderId={order.id}
              assemblyId={order.assemblyId}
              unitsPlanned={order.unitsPlanned}
              pickListItems={order.pickListItems}
            />
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('description')}</TableHead>
                  <TableHead>{t('qty')}</TableHead>
                  <TableHead>{t('unitPrice')}</TableHead>
                  <TableHead>{t('lineTotal')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.pickListItems.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="max-w-[260px] truncate" title={line.description}>{line.description}</TableCell>
                    <TableCell>{line.qty}</TableCell>
                    <TableCell>{line.unitPriceEur ?? '—'}</TableCell>
                    <TableCell>{line.lineTotalEur ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {order.stageEvents && order.stageEvents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('stageHistory')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('stage')}</TableHead>
                  <TableHead>{t('date')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.stageEvents.map((ev) => (
                  <TableRow key={ev.id}>
                    <TableCell>{stages?.[ev.stageIndex]?.name ?? ev.stageIndex}</TableCell>
                    <TableCell>{new Date(ev.createdAt).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {order.finishedGoods && order.finishedGoods.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('finishedGoods')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('serialNumber')}</TableHead>
                  <TableHead>{t('status')}</TableHead>
                  <TableHead>{t('manufactureDate')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.finishedGoods.map((fg) => (
                  <TableRow key={fg.id}>
                    <TableCell>
                      <Link href={`/production/finished-goods/${fg.id}`} className="text-primary hover:underline">
                        {fg.serialNumber}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={FG_STATUS_VARIANT[fg.status]}>{t(`fgStatus${fg.status}`)}</Badge>
                    </TableCell>
                    <TableCell>{new Date(fg.manufactureDate).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
