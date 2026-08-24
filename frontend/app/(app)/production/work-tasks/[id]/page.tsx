'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus, X } from 'lucide-react';
import {
  useWorkTask,
  useUpdateWorkTask,
  useSetWorkTaskItems,
  useCloseWorkTask,
  useReopenWorkTask,
  useDeleteWorkTask,
} from '@/lib/hooks/use-production-labor';
import { useCustomerOrders, useCustomerOrder } from '@/lib/hooks/use-sales';
import { useAssembly } from '@/lib/hooks/use-bom';
import { ProductionExecutionsPanel } from '@/components/domain/production/production-executions-panel';
import { EntityCombobox } from '@/components/domain/shared/entity-combobox';
import { formatEur } from '@/lib/utils';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { useHasPermission } from '@/lib/hooks/use-roles';
import { LoadingBlock } from '@/components/ui/loading-block';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';

/** Resolves a WorkTaskItem's tagged CustomerOrderItem back to a readable label — same "raw id isn't acceptable to show a user" fix as production/[id]/page.tsx's ShortageComponentCell. */
function TaggedItemLabel({ assemblyId, orderNumber, qty }: { assemblyId: string; orderNumber: string | null; qty: string }) {
  const { data: assembly } = useAssembly(assemblyId);
  return (
    <span>
      {orderNumber ? `№${orderNumber}` : ''} — {assembly ? `${assembly.name}${assembly.article ? ` (${assembly.article})` : ''}` : assemblyId} × {qty}
    </span>
  );
}

function AddTagForm({ existingIds, onAdd }: { existingIds: string[]; onAdd: (customerOrderItemId: string) => void }) {
  const t = useTranslations('production');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [orderId, setOrderId] = useState<string | undefined>(undefined);

  const { data: ordersData } = useCustomerOrders({ search: query, limit: 10 });
  const { data: order } = useCustomerOrder(orderId);
  const availableItems = (order?.items ?? []).filter((item) => !existingIds.includes(item.id));

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <Label>{t('selectCustomerOrderPlaceholder')}</Label>
        <EntityCombobox
          query={query}
          onQueryChange={(next) => {
            setQuery(next);
            if (!next) setOrderId(undefined);
          }}
          open={open}
          onOpenChange={setOpen}
          items={ordersData?.items ?? []}
          getKey={(order) => order.id}
          isSelected={(order) => order.id === orderId}
          onSelect={(order) => {
            setQuery(order.orderNumber ?? order.clientName);
            setOpen(false);
            setOrderId(order.id);
          }}
          placeholder={t('selectCustomerOrderPlaceholder')}
          renderItem={(order) => (
            <span className="flex flex-col items-start">
              <span className="font-medium">{order.orderNumber ? `№${order.orderNumber}` : order.clientName}</span>
              <span className="text-xs text-muted-foreground">{order.clientName}</span>
            </span>
          )}
        />
      </div>
      {orderId && (
        <div className="space-y-1.5">
          <Label>{t('selectItemPlaceholder')}</Label>
          <Select onValueChange={(v) => onAdd(v)}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder={t('selectItemPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {availableItems.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  <TaggedItemLabel assemblyId={item.assemblyId} orderNumber={order?.orderNumber ?? null} qty={item.qty} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

export default function WorkTaskDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('production');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const canManage = useHasPermission('work-tasks:manage');
  const canRecordExecutions = useHasPermission('production-executions:record');
  const canConfirmExecutions = useHasPermission('production-executions:confirm');

  const { data: task, isLoading } = useWorkTask(params.id);
  const updateTask = useUpdateWorkTask(params.id);
  const setItems = useSetWorkTaskItems(params.id);
  const closeTask = useCloseWorkTask();
  const reopenTask = useReopenWorkTask();
  const deleteTask = useDeleteWorkTask();

  const [title, setTitle] = useState('');
  const [fund, setFund] = useState('');
  const hydrated = useRef(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (task && !hydrated.current) {
      hydrated.current = true;
      setTitle(task.title);
      setFund(task.fund);
    }
  }, [task]);

  if (isLoading || !task) return <LoadingBlock />;

  async function handleSave() {
    setFormError(null);
    const fundValue = Number(fund);
    if (!title.trim() || !fundValue || fundValue < 0) {
      setFormError(t('invalidRow'));
      return;
    }
    try {
      await updateTask.mutateAsync({ title: title.trim(), fund: fundValue });
    } catch (err) {
      setFormError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleClose() {
    setFormError(null);
    try {
      await closeTask.mutateAsync(params.id);
    } catch (err) {
      setFormError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleReopen() {
    setFormError(null);
    try {
      await reopenTask.mutateAsync(params.id);
    } catch (err) {
      setFormError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleDelete() {
    setFormError(null);
    try {
      await deleteTask.mutateAsync(params.id);
      router.replace('/production/work-tasks');
    } catch (err) {
      setFormError(apiErrorMessage(err, tc('error')));
      setDeleteOpen(false);
    }
  }

  async function handleAddTag(customerOrderItemId: string) {
    const currentIds = (task!.items ?? []).map((i) => i.customerOrderItemId);
    setFormError(null);
    try {
      await setItems.mutateAsync([...currentIds, customerOrderItemId]);
    } catch (err) {
      setFormError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleRemoveTag(customerOrderItemId: string) {
    const currentIds = (task!.items ?? []).map((i) => i.customerOrderItemId).filter((id) => id !== customerOrderItemId);
    setFormError(null);
    try {
      await setItems.mutateAsync(currentIds);
    } catch (err) {
      setFormError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">{task.title}</h2>
          <Badge variant={task.status === 'CLOSED' ? 'secondary' : 'success'}>{t(`workTaskStatus${task.status}`)}</Badge>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            {task.status === 'OPEN' ? (
              <Button variant="outline" size="sm" onClick={handleClose} loading={closeTask.isPending}>
                {t('closeWorkTaskAction')}
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={handleReopen} loading={reopenTask.isPending}>
                {t('reopenWorkTaskAction')}
              </Button>
            )}
            <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <DialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  {tc('delete')}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('deleteWorkTaskConfirmTitle')}</DialogTitle>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">{tc('cancel')}</Button>
                  </DialogClose>
                  <Button variant="destructive" loading={deleteTask.isPending} onClick={handleDelete}>
                    {tc('delete')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('workTaskTitleLabel')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <fieldset disabled={!canManage} className="contents">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t('workTaskTitleLabel')}</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('fundLabel')}</Label>
                <Input type="number" step="any" min={0} value={fund} onChange={(e) => setFund(e.target.value)} />
              </div>
            </div>
          </fieldset>
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          {canManage && (
            <Button variant="outline" onClick={handleSave} loading={updateTask.isPending}>
              {tc('save')}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('workTaskTags')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">{t('workTaskTagsHint')}</p>
          <Table>
            <TableBody>
              {(task.items ?? []).length === 0 ? (
                <TableRow>
                  <TableCell className="py-4 text-center text-muted-foreground">{tc('noResults')}</TableCell>
                </TableRow>
              ) : (
                (task.items ?? []).map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      {item.customerOrderItem ? (
                        <TaggedItemLabel
                          assemblyId={item.customerOrderItem.assemblyId}
                          orderNumber={null}
                          qty={item.customerOrderItem.qty}
                        />
                      ) : (
                        item.customerOrderItemId
                      )}
                    </TableCell>
                    <TableCell className="w-10">
                      {canManage && (
                        <Button variant="ghost" size="icon" onClick={() => handleRemoveTag(item.customerOrderItemId)}>
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {canManage && (
            <AddTagForm existingIds={(task.items ?? []).map((i) => i.customerOrderItemId)} onAdd={handleAddTag} />
          )}
        </CardContent>
      </Card>

      <ProductionExecutionsPanel
        parent={{ kind: 'work-task', workTaskId: task.id, fund: Number(task.fund) }}
        canRecord={canRecordExecutions}
        canConfirm={canConfirmExecutions}
      />
    </div>
  );
}
