'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import {
  usePayrollPeriods,
  useCreatePayrollPeriod,
  useClosePayrollPeriod,
  useReopenPayrollPeriod,
} from '@/lib/hooks/use-hr';
import type { PayrollPeriod } from '@/lib/api-client/hr';
import { fromDatetimeLocalValue } from '@/lib/utils';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { useHasPermission } from '@/lib/hooks/use-roles';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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

export default function PayrollPeriodsPage() {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const { data, isLoading } = usePayrollPeriods({});
  const createPeriod = useCreatePayrollPeriod();
  const closePeriod = useClosePayrollPeriod();
  const reopenPeriod = useReopenPayrollPeriod();
  const canManage = useHasPermission('payroll-periods:manage');

  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [closeTarget, setCloseTarget] = useState<PayrollPeriod | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const periodStart = fromDatetimeLocalValue(start);
    const periodEnd = fromDatetimeLocalValue(end);
    if (!periodStart || !periodEnd) return;
    setCreateError(null);
    try {
      await createPeriod.mutateAsync({ periodStart, periodEnd });
      setStart('');
      setEnd('');
    } catch (err) {
      setCreateError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleClose() {
    if (!closeTarget) return;
    setRowError(null);
    try {
      await closePeriod.mutateAsync(closeTarget.id);
      setCloseTarget(null);
    } catch (err) {
      setRowError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleReopen(id: string) {
    setRowError(null);
    try {
      await reopenPeriod.mutateAsync(id);
    } catch (err) {
      setRowError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('newPayrollPeriod')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="flex flex-wrap items-end gap-3" onSubmit={handleCreate}>
              <div className="space-y-1.5">
                <Label htmlFor="periodStart">{t('periodStartLabel')}</Label>
                <Input id="periodStart" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="periodEnd">{t('periodEndLabel')}</Label>
                <Input id="periodEnd" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
              <Button type="submit" loading={createPeriod.isPending}>
                <Plus className="mr-2 h-4 w-4" />
                {tc('create')}
              </Button>
            </form>
            {createError && <p className="mt-2 text-sm text-destructive">{createError}</p>}
          </CardContent>
        </Card>
      )}

      {rowError && <p className="text-sm text-destructive">{rowError}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('periodStartLabel')}</TableHead>
            <TableHead>{t('periodEndLabel')}</TableHead>
            <TableHead>{t('periodStatus')}</TableHead>
            <TableHead className="w-40">{tc('actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                {tc('loading')}
              </TableCell>
            </TableRow>
          ) : !data || data.items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                {tc('noResults')}
              </TableCell>
            </TableRow>
          ) : (
            data.items.map((period) => (
              <TableRow key={period.id}>
                <TableCell>{new Date(period.periodStart).toLocaleDateString()}</TableCell>
                <TableCell>{new Date(period.periodEnd).toLocaleDateString()}</TableCell>
                <TableCell>
                  <Badge variant={period.status === 'CLOSED' ? 'destructive' : 'success'}>{t(`periodStatus${period.status}`)}</Badge>
                </TableCell>
                <TableCell>
                  {canManage && period.status === 'OPEN' && (
                    <Dialog open={closeTarget?.id === period.id} onOpenChange={(o) => setCloseTarget(o ? period : null)}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline">
                          {t('closePeriodAction')}
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>{t('closePeriodConfirmTitle')}</DialogTitle>
                          <DialogDescription>{t('closePeriodConfirmDescription')}</DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                          <DialogClose asChild>
                            <Button variant="outline">{tc('cancel')}</Button>
                          </DialogClose>
                          <Button loading={closePeriod.isPending} onClick={handleClose}>
                            {tc('confirm')}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  )}
                  {canManage && period.status === 'CLOSED' && (
                    <Button size="sm" variant="outline" onClick={() => handleReopen(period.id)} loading={reopenPeriod.isPending}>
                      {t('reopenPeriodAction')}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
