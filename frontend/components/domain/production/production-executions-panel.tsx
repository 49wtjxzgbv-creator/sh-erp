'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import {
  useProductionExecutions,
  useCreateProductionExecution,
  useDeleteProductionExecution,
  useConfirmProductionExecution,
  useVoidProductionExecution,
  useCorrectProductionExecution,
} from '@/lib/hooks/use-production-labor';
import { useTeams } from '@/lib/hooks/use-hr';
import type {
  ProductionExecution,
  ProductionExecutionMethod,
  ExecutionAllocationMode,
  CreateProductionExecutionInput,
} from '@/lib/api-client/production-labor';
import { toNumber } from '@/lib/api-client/decimal';
import { formatEur, toDatetimeLocalValue, fromDatetimeLocalValue } from '@/lib/utils';
import { useApiErrorMessage } from '@/lib/api-error-message';
import {
  ExecutionAllocationEditor,
  allocationsToRows,
  rowsToAllocations,
  type EditableAllocationRow,
} from './execution-allocation-editor';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
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

const EXEC_STATUS_VARIANT: Record<ProductionExecution['status'], 'secondary' | 'warning' | 'success' | 'destructive'> = {
  DRAFT: 'warning',
  CONFIRMED: 'success',
  VOIDED: 'destructive',
};

type ParentRef =
  | { kind: 'production-order'; productionOrderId: string; unitsPlanned: number; laborCostEur: number }
  | { kind: 'work-task'; workTaskId: string; fund: number };

interface FormState {
  performedAt: string;
  qtyCompleted: string;
  totalAmount: string;
  method: ProductionExecutionMethod;
  teamId: string;
  allocationMode: ExecutionAllocationMode;
  note: string;
  rows: EditableAllocationRow[];
}

function emptyForm(mode: ExecutionAllocationMode = 'PERCENT'): FormState {
  return {
    performedAt: toDatetimeLocalValue(new Date().toISOString()),
    qtyCompleted: '',
    totalAmount: '',
    method: 'SOLO',
    teamId: '',
    allocationMode: mode,
    note: '',
    rows: [],
  };
}

/**
 * Shared read/write panel for a ProductionOrder batch's labor OR a
 * standalone GENERAL WorkTask's labor — one component, parametrized by
 * `parent`, matching every other `kind`-parametrized shared component in
 * this codebase (e.g. finance's document-drawer.tsx). Renders the
 * execution history table + the record/confirm/void/correct actions;
 * "remaining fund/quantity" is always derived client-side from the already-
 * fetched CONFIRMED rows, never a separate summary endpoint.
 */
export function ProductionExecutionsPanel({ parent, canRecord, canConfirm }: { parent: ParentRef; canRecord: boolean; canConfirm: boolean }) {
  const t = useTranslations('production');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();

  const query = parent.kind === 'production-order' ? { productionOrderId: parent.productionOrderId } : { workTaskId: parent.workTaskId };
  const { data, isLoading } = useProductionExecutions(query);
  const { data: teamsData } = useTeams({});
  const createExecution = useCreateProductionExecution();
  const deleteExecution = useDeleteProductionExecution();
  const confirmExecution = useConfirmProductionExecution();
  const voidExecution = useVoidProductionExecution();
  const correctExecution = useCorrectProductionExecution();

  const [recordOpen, setRecordOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<ProductionExecution | null>(null);
  const [voidNote, setVoidNote] = useState('');
  const [correctTarget, setCorrectTarget] = useState<ProductionExecution | null>(null);
  const [correctForm, setCorrectForm] = useState<FormState>(() => emptyForm());
  const [deleteTarget, setDeleteTarget] = useState<ProductionExecution | null>(null);

  const items = useMemo(() => [...(data?.items ?? [])].sort((a, b) => +new Date(b.performedAt) - +new Date(a.performedAt)), [data]);

  const { confirmedQty, confirmedAmount } = useMemo(() => {
    let qty = 0;
    let amount = 0;
    for (const e of data?.items ?? []) {
      if (e.status !== 'CONFIRMED') continue;
      qty += toNumber(e.qtyCompleted) ?? 0;
      amount += toNumber(e.totalAmount) ?? 0;
    }
    return { confirmedQty: qty, confirmedAmount: amount };
  }, [data]);

  const fund = parent.kind === 'production-order' ? parent.laborCostEur : parent.fund;
  const remainingFund = Math.max(fund - confirmedAmount, 0);
  const remainingQty = parent.kind === 'production-order' ? Math.max(parent.unitsPlanned - confirmedQty, 0) : null;

  function buildCreateInput(f: FormState): CreateProductionExecutionInput | null {
    const allocations = rowsToAllocations(f.rows, f.allocationMode);
    if (!allocations) return null;
    const base = {
      performedAt: fromDatetimeLocalValue(f.performedAt) ?? new Date().toISOString(),
      method: f.method,
      teamId: f.teamId || undefined,
      allocationMode: f.allocationMode,
      allocations,
      note: f.note || undefined,
    };
    if (parent.kind === 'production-order') {
      const qty = Number(f.qtyCompleted);
      if (!qty || qty <= 0) return null;
      return { ...base, productionOrderId: parent.productionOrderId, qtyCompleted: qty };
    }
    const amount = Number(f.totalAmount);
    if (!amount || amount <= 0) return null;
    return { ...base, workTaskId: parent.workTaskId, totalAmount: amount, qtyCompleted: f.qtyCompleted ? Number(f.qtyCompleted) : undefined };
  }

  async function handleCreate() {
    setFormError(null);
    const dto = buildCreateInput(form);
    if (!dto) {
      setFormError(t('invalidRow'));
      return;
    }
    try {
      await createExecution.mutateAsync(dto);
      setForm(emptyForm(form.allocationMode));
      setRecordOpen(false);
    } catch (err) {
      setFormError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleConfirm(id: string) {
    setRowError(null);
    try {
      await confirmExecution.mutateAsync(id);
    } catch (err) {
      setRowError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setRowError(null);
    try {
      await deleteExecution.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      setRowError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleVoid() {
    if (!voidTarget) return;
    setRowError(null);
    try {
      await voidExecution.mutateAsync({ id: voidTarget.id, note: voidNote || undefined });
      setVoidTarget(null);
      setVoidNote('');
    } catch (err) {
      setRowError(apiErrorMessage(err, tc('error')));
    }
  }

  function openCorrect(execution: ProductionExecution) {
    setCorrectTarget(execution);
    setCorrectForm({
      performedAt: toDatetimeLocalValue(new Date().toISOString()),
      qtyCompleted: execution.qtyCompleted ?? '',
      totalAmount: '',
      method: execution.method,
      teamId: execution.teamId ?? '',
      allocationMode: execution.allocationMode,
      note: '',
      rows: allocationsToRows(
        execution.allocations.map((a) => ({
          employeeId: a.employeeId,
          percent: a.percent !== null ? Number(a.percent) : undefined,
          hours: a.hours !== null ? Number(a.hours) : undefined,
        })),
        execution.allocationMode,
      ),
    });
  }

  async function handleCorrect() {
    if (!correctTarget) return;
    setFormError(null);
    const dto = buildCreateInput(correctForm);
    if (!dto) {
      setFormError(t('invalidRow'));
      return;
    }
    const { productionOrderId, workTaskId, ...rest } = dto;
    try {
      await correctExecution.mutateAsync({ id: correctTarget.id, dto: rest });
      setCorrectTarget(null);
    } catch (err) {
      setFormError(apiErrorMessage(err, tc('error')));
    }
  }

  function renderFormFields(f: FormState, setF: (updater: (prev: FormState) => FormState) => void) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t('performedAt')}</Label>
            <Input type="datetime-local" value={f.performedAt} onChange={(e) => setF((p) => ({ ...p, performedAt: e.target.value }))} />
          </div>
          {parent.kind === 'production-order' ? (
            <div className="space-y-1.5">
              <Label>{t('qtyCompletedLabel')}</Label>
              <Input
                type="number"
                step="any"
                min={0}
                value={f.qtyCompleted}
                onChange={(e) => setF((p) => ({ ...p, qtyCompleted: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">{t('computedAmountHint')}</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>{t('totalAmountLabel')}</Label>
              <Input
                type="number"
                step="any"
                min={0}
                value={f.totalAmount}
                onChange={(e) => setF((p) => ({ ...p, totalAmount: e.target.value }))}
              />
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>{t('method')}</Label>
            <Select value={f.method} onValueChange={(v) => setF((p) => ({ ...p, method: v as ProductionExecutionMethod }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SOLO">{t('methodSOLO')}</SelectItem>
                <SelectItem value="TEAM">{t('methodTEAM')}</SelectItem>
                <SelectItem value="MULTI_WORKER">{t('methodMULTI_WORKER')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t('teamOptional')}</Label>
            <Select value={f.teamId || '__none'} onValueChange={(v) => setF((p) => ({ ...p, teamId: v === '__none' ? '' : v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">{t('noTeam')}</SelectItem>
                {teamsData?.items.map((team) => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t('allocationMode')}</Label>
            <Select
              value={f.allocationMode}
              onValueChange={(v) => setF((p) => ({ ...p, allocationMode: v as ExecutionAllocationMode }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PERCENT">{t('allocationModePERCENT')}</SelectItem>
                <SelectItem value="HOURS">{t('allocationModeHOURS')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>{t('allocationsLabel')}</Label>
          <ExecutionAllocationEditor rows={f.rows} mode={f.allocationMode} onChange={(rows) => setF((p) => ({ ...p, rows }))} />
        </div>
        <div className="space-y-1.5">
          <Label>{t('executionNote')}</Label>
          <Textarea value={f.note} onChange={(e) => setF((p) => ({ ...p, note: e.target.value }))} rows={2} />
        </div>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{t('laborExecutions')}</CardTitle>
        {canRecord && (
          <Dialog open={recordOpen} onOpenChange={(o) => { setRecordOpen(o); if (!o) setFormError(null); }}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={() => setForm(emptyForm())}>
                <Plus className="mr-2 h-4 w-4" />
                {t('recordExecution')}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>{t('recordExecution')}</DialogTitle>
              </DialogHeader>
              {renderFormFields(form, (updater) => setForm(updater))}
              {formError && <p className="text-sm text-destructive">{formError}</p>}
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">{tc('cancel')}</Button>
                </DialogClose>
                <Button onClick={handleCreate} loading={createExecution.isPending}>
                  {tc('save')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {remainingQty !== null && (
            <div>
              <p className="text-xs text-muted-foreground">{t('remainingQty')}</p>
              <p className="text-sm">{remainingQty}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-muted-foreground">{t('remainingFund')}</p>
            <p className="text-sm">{formatEur(remainingFund)}</p>
          </div>
        </div>

        {rowError && <p className="text-sm text-destructive">{rowError}</p>}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('performedAt')}</TableHead>
              {parent.kind === 'production-order' && <TableHead>{t('qtyCompletedLabel')}</TableHead>}
              <TableHead>{t('totalAmountLabel')}</TableHead>
              <TableHead>{t('method')}</TableHead>
              <TableHead>{t('executionStatus')}</TableHead>
              <TableHead className="w-56">{tc('actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                  {tc('loading')}
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
                  {parent.kind === 'production-order' && <TableCell>{execution.qtyCompleted ?? '—'}</TableCell>}
                  <TableCell>{formatEur(Number(execution.totalAmount))}</TableCell>
                  <TableCell>{t(`method${execution.method}`)}</TableCell>
                  <TableCell>
                    <Badge variant={EXEC_STATUS_VARIANT[execution.status]}>{t(`executionStatus${execution.status}`)}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {execution.status === 'DRAFT' && canConfirm && (
                        <Button size="sm" onClick={() => handleConfirm(execution.id)} loading={confirmExecution.isPending}>
                          {t('confirmExecution')}
                        </Button>
                      )}
                      {execution.status === 'DRAFT' && canRecord && (
                        <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(execution)}>
                          {tc('delete')}
                        </Button>
                      )}
                      {execution.status === 'CONFIRMED' && canConfirm && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => setVoidTarget(execution)}>
                            {t('voidExecution')}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => openCorrect(execution)}>
                            {t('correctExecution')}
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('deleteExecutionConfirmTitle')}</DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{tc('cancel')}</Button>
            </DialogClose>
            <Button variant="destructive" loading={deleteExecution.isPending} onClick={handleDelete}>
              {tc('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(voidTarget)} onOpenChange={(o) => { if (!o) { setVoidTarget(null); setVoidNote(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('voidExecutionConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('voidExecutionConfirmDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>{t('voidNoteLabel')}</Label>
            <Textarea value={voidNote} onChange={(e) => setVoidNote(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{tc('cancel')}</Button>
            </DialogClose>
            <Button variant="destructive" loading={voidExecution.isPending} onClick={handleVoid}>
              {t('voidExecution')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(correctTarget)} onOpenChange={(o) => !o && setCorrectTarget(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('correctExecution')}</DialogTitle>
          </DialogHeader>
          {correctTarget && renderFormFields(correctForm, (updater) => setCorrectForm(updater))}
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{tc('cancel')}</Button>
            </DialogClose>
            <Button onClick={handleCorrect} loading={correctExecution.isPending}>
              {tc('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
