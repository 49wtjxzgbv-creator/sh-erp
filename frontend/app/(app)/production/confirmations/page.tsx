'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Send } from 'lucide-react';
import {
  useProductionExecutions,
  useConfirmProductionExecution,
  useDeleteProductionExecution,
  usePatchProductionExecution,
} from '@/lib/hooks/use-production-labor';
import { useProductionOrder } from '@/lib/hooks/use-production';
import { useWorkTask } from '@/lib/hooks/use-production-labor';
import { useAssembly } from '@/lib/hooks/use-bom';
import { useEmployee } from '@/lib/hooks/use-hr';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { useHasPermission } from '@/lib/hooks/use-roles';
import { useApiErrorMessage } from '@/lib/api-error-message';
import type { ProductionExecution } from '@/lib/api-client/production-labor';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingBlock } from '@/components/ui/loading-block';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { useState } from 'react';

function EmployeeNames({ execution }: { execution: ProductionExecution }) {
  return (
    <>
      {execution.allocations.map((a, i) => (
        <EmployeeName key={a.id} employeeId={a.employeeId} last={i === execution.allocations.length - 1} />
      ))}
    </>
  );
}

function EmployeeName({ employeeId, last }: { employeeId: string; last: boolean }) {
  const { data: employee } = useEmployee(employeeId);
  return (
    <>
      {employee?.fullName ?? '…'}
      {!last && ', '}
    </>
  );
}

function ParentCell({ execution }: { execution: ProductionExecution }) {
  const t = useTranslations('production');
  const { data: order } = useProductionOrder(execution.productionOrderId ?? undefined);
  const { data: assembly } = useAssembly(order?.assemblyId);
  const { data: workTask } = useWorkTask(execution.workTaskId ?? undefined);
  const { data: photosByAssembly } = useFilesForEntities('Assembly', order?.assemblyId ? [order.assemblyId] : [], 'ASSEMBLY_PHOTO');

  if (execution.productionOrderId) {
    return (
      <Link href={`/production/${execution.productionOrderId}`} className="flex items-center gap-2 text-primary hover:underline">
        <Avatar src={order?.assemblyId ? photosByAssembly?.[order.assemblyId]?.[0]?.downloadUrl : undefined} size="sm" />
        {assembly ? `${assembly.article ? `${assembly.article} — ` : ''}${assembly.name}` : '…'}
      </Link>
    );
  }
  return (
    <Link href={`/production/work-tasks/${execution.workTaskId}`} className="text-primary hover:underline">
      {workTask?.title ?? t('confirmationsGeneralWorkFallback')}
    </Link>
  );
}

/**
 * "Скоригувати кількість" / "Скасувати" (2026-10-01 user request — a
 * bot-submitted DRAFT only had a confirm button, no way to fix a typo'd
 * quantity or reject it outright before it becomes a real payroll entry).
 * A DRAFT's qtyCompleted is freely editable (ProductionExecutionsService
 * #patch re-derives totalAmount from the edited qty, same server-side
 * recompute "Передати у виробництво" already relies on) — only shown for
 * a PRODUCT execution (productionOrderId set), since a GENERAL/WorkTask
 * execution's totalAmount is a manually-entered figure, not a
 * qty-derived one, and isn't what this request was about.
 */
function EditQtyDialog({ execution }: { execution: ProductionExecution }) {
  const t = useTranslations('production');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const patchExecution = usePatchProductionExecution(execution.id);
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    const parsed = Number(qty.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError(t('confirmationsInvalidQty'));
      return;
    }
    try {
      await patchExecution.mutateAsync({ qtyCompleted: parsed });
      setOpen(false);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) { setQty(String(execution.qtyCompleted ?? '')); setError(null); } }}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          {tc('edit')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('confirmationsEditQtyTitle')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={`qty-${execution.id}`}>{t('qtyCompletedLabel')}</Label>
          <Input id={`qty-${execution.id}`} type="number" step="any" min={0} value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{tc('cancel')}</Button>
          </DialogClose>
          <Button loading={patchExecution.isPending} onClick={handleSave}>
            {tc('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Подано через Telegram ... надходить на підтвердження" (2026-10-01 user
 * request) — a global queue of every DRAFT ProductionExecution across every
 * order/work task, which previously only existed per-parent
 * (ProductionExecutionsPanel, embedded in each order's/task's own detail
 * page — a supervisor had to already know where to look). Confirming here
 * is the exact same action (useConfirmProductionExecution), just reachable
 * without first finding the right parent — a bot-submitted execution is a
 * completely ordinary DRAFT row, nothing is duplicated. "Редагувати"/
 * "Скасувати" (same day, same request) reuse the exact same patch()/
 * remove() actions ProductionExecutionsPanel's own per-order view already
 * offers — not new capabilities, just exposed here too.
 */
export default function ProductionConfirmationsPage() {
  const t = useTranslations('production');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const canConfirm = useHasPermission('production-executions:confirm');
  const canRecord = useHasPermission('production-executions:record');
  const { data, isLoading } = useProductionExecutions({ status: 'DRAFT', limit: 200 });
  const confirmExecution = useConfirmProductionExecution();
  const deleteExecution = useDeleteProductionExecution();
  const [error, setError] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<ProductionExecution | null>(null);

  async function handleConfirm(id: string) {
    setError(null);
    try {
      await confirmExecution.mutateAsync(id);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleReject() {
    if (!rejectTarget) return;
    setError(null);
    try {
      await deleteExecution.mutateAsync(rejectTarget.id);
      setRejectTarget(null);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('confirmationsDescription')}</p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('performedAt')}</TableHead>
            <TableHead>{t('confirmationsItemColumn')}</TableHead>
            <TableHead>{t('qtyCompletedLabel')}</TableHead>
            <TableHead>{t('confirmationsEmployeeColumn')}</TableHead>
            <TableHead>{t('totalAmountLabel')}</TableHead>
            <TableHead className="w-64">{tc('actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                <LoadingBlock />
              </TableCell>
            </TableRow>
          ) : items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                {tc('noResults')}
              </TableCell>
            </TableRow>
          ) : (
            items.map((execution) => (
              <TableRow key={execution.id}>
                <TableCell>{new Date(execution.performedAt).toLocaleString()}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <ParentCell execution={execution} />
                    {execution.submittedViaTelegram && (
                      <Badge variant="secondary" className="gap-1">
                        <Send className="h-3 w-3" />
                        Telegram
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>{execution.qtyCompleted ?? '—'}</TableCell>
                <TableCell>
                  <EmployeeNames execution={execution} />
                </TableCell>
                <TableCell>{Number(execution.totalAmount).toFixed(2)} €</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    {canConfirm && (
                      <Button size="sm" loading={confirmExecution.isPending} onClick={() => handleConfirm(execution.id)}>
                        {t('confirmExecution')}
                      </Button>
                    )}
                    {canRecord && execution.productionOrderId && <EditQtyDialog execution={execution} />}
                    {canRecord && (
                      <Button type="button" size="sm" variant="ghost" onClick={() => setRejectTarget(execution)}>
                        {t('confirmationsReject')}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <Dialog open={Boolean(rejectTarget)} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('deleteExecutionConfirmTitle')}</DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{tc('cancel')}</Button>
            </DialogClose>
            <Button variant="destructive" loading={deleteExecution.isPending} onClick={handleReject}>
              {t('confirmationsReject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
