'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LoadingBlock } from '@/components/ui/loading-block';
import {
  useProductionOrder,
  useProductionStages,
  useSetProductionOrderWorkers,
  useCancelProductionOrder,
  useDeleteProductionOrder,
  useStartProductionOrder,
  useAdvanceProductionOrderStage,
  useProductionOrderStagePlan,
  useSetProductionOrderStagePlan,
} from '@/lib/hooks/use-production';
import { useWarehouses } from '@/lib/hooks/use-inventory';
import { useAssembly } from '@/lib/hooks/use-bom';
import { useProduct } from '@/lib/hooks/use-catalog';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { formatEur, toDatetimeLocalValue, fromDatetimeLocalValue } from '@/lib/utils';
import { ApiError } from '@/lib/api-client/types';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { useHasPermission } from '@/lib/hooks/use-roles';
import type { ProductionOrderStatus, FinishedGoodStatus, ProductionShortageLine, ProductionStage } from '@/lib/api-client/production';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { WorkerEditor, workersToRows, rowsToWorkers, type EditableWorkerRow } from '@/components/domain/production/worker-editor';
import { ProductionExecutionsPanel } from '@/components/domain/production/production-executions-panel';
import { PickListPrint } from '@/components/domain/production/pick-list-print';
import { AssemblySpecPrint } from '@/components/domain/bom/assembly-spec-print';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
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

function fmtEur(v: string | null | undefined): string {
  return v != null ? formatEur(Number(v)) : '—';
}

/**
 * Resolves a start()-failure shortage line's raw productId/subAssemblyId to
 * a real name — same "raw id isn't acceptable to show a user" fix applied
 * everywhere else (bom/[id]/availability/page.tsx's ShortageProductCell).
 * ASSEMBLY-kind lines mean the required sub-assembly hasn't been *produced*
 * yet (start() checks `FinishedGood` rows with status IN_STOCK, not
 * whether it's composable) — worth a visible hint since "start production"
 * failing here isn't a data problem, it's "produce the sub-assembly first".
 */
function ShortageComponentCell({ line }: { line: ProductionShortageLine }) {
  const t = useTranslations('production');
  const { data: product } = useProduct(line.kind === 'PRODUCT' ? line.productId : undefined);
  const { data: subAssembly } = useAssembly(line.kind === 'ASSEMBLY' ? line.subAssemblyId : undefined);
  if (line.kind === 'PRODUCT') {
    return <>{product ? `${product.name}${product.article ? ` (${product.article})` : ''}` : line.productId}</>;
  }
  const name = subAssembly ? `${subAssembly.name}${subAssembly.article ? ` (${subAssembly.article})` : ''}` : line.subAssemblyId;
  return (
    <>
      {name} <span className="text-muted-foreground">— {t('subAssemblyNotProduced')}</span>
    </>
  );
}

/**
 * Per-batch plan (План-графік §2) — plan only, kept separate from
 * stageEvents (fact). Every stage this company has configured is shown,
 * merged from `stages` (the full catalogue) with whatever plan rows
 * already exist; a stage with no dates yet shows "Етап не запланований",
 * never a guessed date. Each stage's window is edited independently — no
 * auto-split of the batch's overall window across stages.
 */
function StagePlanEditor({ productionOrderId, stages }: { productionOrderId: string; stages: ProductionStage[] }) {
  const t = useTranslations('production');
  const tc = useTranslations('common');
  const { data: plan } = useProductionOrderStagePlan(productionOrderId);
  const setPlan = useSetProductionOrderStagePlan(productionOrderId);
  const canManage = useHasPermission('production-orders:manage');
  const apiErrorMessage = useApiErrorMessage();

  const [rows, setRows] = useState<Record<string, { start: string; end: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current || !plan) return;
    initialized.current = true;
    const byStage: Record<string, { start: string; end: string }> = {};
    for (const stage of stages) {
      const existing = plan.find((p) => p.productionStageId === stage.id);
      byStage[stage.id] = {
        start: toDatetimeLocalValue(existing?.plannedStartAt),
        end: toDatetimeLocalValue(existing?.plannedEndAt),
      };
    }
    setRows(byStage);
  }, [plan, stages]);

  if (stages.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('stagePlanEmpty')}</p>;
  }

  async function handleSave() {
    setError(null);
    try {
      await setPlan.mutateAsync(
        stages.map((stage) => ({
          productionStageId: stage.id,
          plannedStartAt: fromDatetimeLocalValue(rows[stage.id]?.start ?? ''),
          plannedEndAt: fromDatetimeLocalValue(rows[stage.id]?.end ?? ''),
        })),
      );
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <div className="space-y-3">
      <fieldset disabled={!canManage} className="contents">
      {[...stages].sort((a, b) => a.sortOrder - b.sortOrder).map((stage) => {
        const row = rows[stage.id] ?? { start: '', end: '' };
        return (
          <div key={stage.id} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-3">
            <p className="text-sm font-medium sm:col-span-1">
              {stage.name}
              {!row.start && !row.end && <span className="ml-2 text-xs text-muted-foreground">({t('stageNotPlanned')})</span>}
            </p>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t('plannedStartAt')}</Label>
              <Input
                type="datetime-local"
                value={row.start}
                onChange={(e) => setRows((r) => ({ ...r, [stage.id]: { ...r[stage.id], start: e.target.value, end: r[stage.id]?.end ?? '' } }))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t('plannedEndAt')}</Label>
              <Input
                type="datetime-local"
                value={row.end}
                onChange={(e) => setRows((r) => ({ ...r, [stage.id]: { ...r[stage.id], end: e.target.value, start: r[stage.id]?.start ?? '' } }))}
              />
            </div>
          </div>
        );
      })}
      </fieldset>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {canManage && (
        <Button variant="outline" onClick={handleSave} loading={setPlan.isPending}>
          {t('savePlan')}
        </Button>
      )}
    </div>
  );
}

export default function ProductionOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('production');
  const tb = useTranslations('bom');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();

  const { data: order, isLoading } = useProductionOrder(params.id);
  const { data: stages } = useProductionStages();
  const { data: warehouses } = useWarehouses();
  const { data: assembly } = useAssembly(order?.assemblyId);
  const { data: photosByAssembly } = useFilesForEntities('Assembly', order ? [order.assemblyId] : [], 'ASSEMBLY_PHOTO');

  const setWorkers = useSetProductionOrderWorkers(params.id);
  const cancelOrder = useCancelProductionOrder(params.id);
  const deleteOrder = useDeleteProductionOrder();
  const startOrder = useStartProductionOrder(params.id);
  const advanceStage = useAdvanceProductionOrderStage(params.id);
  const canManage = useHasPermission('production-orders:manage');
  const canDelete = useHasPermission('production-orders:delete');
  const canRecordExecutions = useHasPermission('production-executions:record');
  const canConfirmExecutions = useHasPermission('production-executions:confirm');

  const [workerRows, setWorkerRows] = useState<EditableWorkerRow[]>([]);
  const workersHydrated = useRef(false);
  const [workersError, setWorkersError] = useState<string | null>(null);
  const [warehouseId, setWarehouseId] = useState<string | undefined>(undefined);
  const [startError, setStartError] = useState<string | null>(null);
  const [startShortages, setStartShortages] = useState<ProductionShortageLine[]>([]);
  const [advanceError, setAdvanceError] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
      setWorkersError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleCancel() {
    setCancelError(null);
    try {
      await cancelOrder.mutateAsync();
    } catch (err) {
      setCancelError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleDelete() {
    setDeleteError(null);
    try {
      await deleteOrder.mutateAsync(params.id);
      router.replace('/production');
    } catch (err) {
      setDeleteError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleStart() {
    setStartError(null);
    setStartShortages([]);
    try {
      await startOrder.mutateAsync({ warehouseId });
    } catch (err) {
      setStartError(apiErrorMessage(err, tc('error')));
      const shortages = err instanceof ApiError ? (err.body as { shortages?: ProductionShortageLine[] } | undefined)?.shortages : undefined;
      setStartShortages(shortages ?? []);
    }
  }

  async function handleAdvance() {
    setAdvanceError(null);
    try {
      await advanceStage.mutateAsync();
    } catch (err) {
      setAdvanceError(apiErrorMessage(err, tc('error')));
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
        <div className="flex items-center gap-2">
          <AssemblySpecPrint assemblyId={order.assemblyId} qty={Number(order.unitsPlanned)} />
          {order.status === 'PLANNED' && canManage && (
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
          {(order.status === 'PLANNED' || order.status === 'CANCELLED') && canDelete && (
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
                  {tc('confirm')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          )}
        </div>
      </div>
      {cancelError && <p className="text-sm text-destructive">{cancelError}</p>}
      {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">{t('assembly')}</p>
            <div className="flex items-center gap-2">
              <Avatar src={photosByAssembly?.[order.assemblyId]?.[0]?.downloadUrl} size="sm" />
              <p className="max-w-[280px] truncate text-sm" title={assembly?.name ?? order.assemblyId}>
                {assembly ? `${assembly.name}${assembly.article ? ` (${assembly.article})` : ''}` : order.assemblyId}
              </p>
            </div>
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('stagePlan')}</CardTitle>
        </CardHeader>
        <CardContent>
          <StagePlanEditor productionOrderId={order.id} stages={stages ?? []} />
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
            {canManage && (
              <Button onClick={handleAdvance} loading={advanceStage.isPending}>
                {isLastStage ? t('completeOrder') : t('advanceStage')}
              </Button>
            )}
            {advanceError && <p className="text-sm text-destructive">{advanceError}</p>}
          </CardContent>
        </Card>
      )}

      {(order.status === 'IN_PROGRESS' || order.status === 'COMPLETED') && (
        <ProductionExecutionsPanel
          parent={{
            kind: 'production-order',
            productionOrderId: order.id,
            unitsPlanned: Number(order.unitsPlanned),
            laborCostEur: Number(order.laborCostEur ?? 0),
          }}
          canRecord={canRecordExecutions}
          canConfirm={canConfirmExecutions}
        />
      )}

      {order.status === 'PLANNED' && canManage && (
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
              {startShortages.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tb('component')}</TableHead>
                      <TableHead>{tb('needed')}</TableHead>
                      <TableHead>{tb('available')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {startShortages.map((s, i) => (
                      <TableRow key={i}>
                        <TableCell><ShortageComponentCell line={s} /></TableCell>
                        <TableCell>{s.needed}</TableCell>
                        <TableCell>{s.available}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
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
              <p className="text-sm">{fmtEur(order.laborCostEur)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('packagingCost')}</p>
              <p className="text-sm">{fmtEur(order.packagingCostEur)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('deliveryCost')}</p>
              <p className="text-sm">{fmtEur(order.deliveryCostEur)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('otherCost')}</p>
              <p className="text-sm">{fmtEur(order.otherCostEur)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('localCost')}</p>
              <p className="text-sm">{fmtEur(order.totalLocalCostEur)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('germanCost')}</p>
              <p className="text-sm">{fmtEur(order.totalGermanCostEur)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('fullCost')}</p>
              <p className="text-sm">{fmtEur(order.fullCostEur)}</p>
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
                    <TableCell>{fmtEur(line.unitPriceEur)}</TableCell>
                    <TableCell>{fmtEur(line.lineTotalEur)}</TableCell>
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
