'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRecordPayrollEntry, useVoidPayrollEntry, usePayrollEntries } from '@/lib/hooks/use-hr';
import { EmployeePicker } from '@/components/domain/hr/employee-picker';
import { CustomerOrderPicker } from '@/components/domain/sales/customer-order-picker';
import { useApiErrorMessage } from '@/lib/api-error-message';
import type { ManualPayrollEntryType, PayrollEntryType, PayrollEntry } from '@/lib/api-client/hr';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';

const PAGE_SIZE = 50;

export default function PayrollPage() {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const recordEntry = useRecordPayrollEntry();
  const voidEntry = useVoidPayrollEntry();
  // "не можу змінити чи редагувати чи видалити запис" (2026-10-14) — the
  // table has no UPDATE/DELETE grants at all, so "Скасувати" is a
  // compensating entry, not an edit; same voidTarget/voidNote dialog
  // shape production-executions-panel.tsx's own void flow already uses.
  const [voidTarget, setVoidTarget] = useState<PayrollEntry | null>(null);
  const [voidNote, setVoidNote] = useState('');
  const [voidError, setVoidError] = useState<string | null>(null);

  const [employeeId, setEmployeeId] = useState<string | undefined>(undefined);
  const [type, setType] = useState<ManualPayrollEntryType>('ADVANCE');
  const [amount, setAmount] = useState('');
  const [entryDate, setEntryDate] = useState('');
  const [comment, setComment] = useState('');
  // "аванс і премія можна давати щоб воно підтягувало до конкретного
  // замовлення" (2026-10-14) — optional, cleared after a successful save
  // same as the other fields below.
  const [recordOrderId, setRecordOrderId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [filterEmployeeId, setFilterEmployeeId] = useState<string | undefined>(undefined);
  const [filterType, setFilterType] = useState<PayrollEntryType | undefined>(undefined);
  const [offset, setOffset] = useState(0);
  const { data, isLoading } = usePayrollEntries({ employeeId: filterEmployeeId, type: filterType, limit: PAGE_SIZE, offset });

  async function handleSubmit() {
    setError(null);
    setSuccess(false);
    const amountNum = Number(amount);
    if (!employeeId || !amountNum || amountNum <= 0) {
      setError(t('invalidEntry'));
      return;
    }
    try {
      await recordEntry.mutateAsync({
        employeeId,
        type,
        amount: amountNum,
        entryDate: entryDate || undefined,
        comment: comment || undefined,
        customerOrderId: recordOrderId,
      });
      setAmount('');
      setComment('');
      setRecordOrderId(undefined);
      setSuccess(true);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleVoid() {
    if (!voidTarget) return;
    setVoidError(null);
    try {
      await voidEntry.mutateAsync({ id: voidTarget.id, note: voidNote || undefined });
      setVoidTarget(null);
      setVoidNote('');
    } catch (err) {
      setVoidError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button asChild variant="outline" size="sm">
          <Link href="/hr/payroll/summary">{t('payrollSummary')}</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('recordEntry')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t('employee')}</Label>
              <EmployeePicker value={employeeId} onChange={(id) => setEmployeeId(id)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('entryType')}</Label>
              <Select value={type} onValueChange={(v) => setType(v as ManualPayrollEntryType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADVANCE">{t('entryTypeADVANCE')}</SelectItem>
                  <SelectItem value="BONUS">{t('entryTypeBONUS')}</SelectItem>
                  <SelectItem value="PENALTY">{t('entryTypePENALTY')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="amount">{t('amount')}</Label>
              <Input id="amount" type="number" step="any" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
              <p className="text-xs text-muted-foreground">{t('amountHint')}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="entryDate">{t('entryDate')}</Label>
              <Input id="entryDate" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="recordOrder">{t('payrollSummaryOrderFilter')}</Label>
              <CustomerOrderPicker value={recordOrderId} onChange={(id) => setRecordOrderId(id)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="comment">{t('comment')}</Label>
              <Textarea id="comment" value={comment} onChange={(e) => setComment(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {success && <p className="text-sm text-success">{t('entryRecorded')}</p>}
          <Button onClick={handleSubmit} loading={recordEntry.isPending}>
            {tc('save')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('ledger')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-64">
              <EmployeePicker value={filterEmployeeId} onChange={(id) => { setFilterEmployeeId(id); setOffset(0); }} placeholder={t('filterByEmployee')} />
            </div>
            <Select value={filterType ?? '__all'} onValueChange={(v) => { setFilterType(v === '__all' ? undefined : (v as PayrollEntryType)); setOffset(0); }}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder={t('filterByType')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">{t('allTypes')}</SelectItem>
                <SelectItem value="PIECEWORK">{t('entryTypePIECEWORK')}</SelectItem>
                <SelectItem value="ADVANCE">{t('entryTypeADVANCE')}</SelectItem>
                <SelectItem value="BONUS">{t('entryTypeBONUS')}</SelectItem>
                <SelectItem value="PENALTY">{t('entryTypePENALTY')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('entryType')}</TableHead>
                <TableHead>{t('amount')}</TableHead>
                <TableHead>{t('entryDate')}</TableHead>
                <TableHead>{t('payrollSummaryOrderFilter')}</TableHead>
                <TableHead>{t('comment')}</TableHead>
                <TableHead>{tc('actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                    {tc('loading')}
                  </TableCell>
                </TableRow>
              ) : !data || data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                    {tc('noResults')}
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>
                      {t(`entryType${entry.type}`)}
                      {entry.voidsEntryId && <span className="ml-1 text-xs text-muted-foreground">({t('voidEntryLabel')})</span>}
                    </TableCell>
                    <TableCell>{entry.amount}</TableCell>
                    <TableCell>{new Date(entry.entryDate).toLocaleDateString()}</TableCell>
                    <TableCell className="max-w-[180px] truncate" title={entry.customerOrderLabel ?? ''}>{entry.customerOrderLabel ?? '—'}</TableCell>
                    <TableCell className="max-w-[220px] truncate" title={entry.comment ?? ''}>{entry.comment ?? '—'}</TableCell>
                    <TableCell>
                      {/* "не можу змінити чи редагувати чи видалити запис"
                          (2026-10-14): only a manual (non-PIECEWORK) entry
                          that isn't itself a void and hasn't already been
                          voided can be voided — matches the backend's own
                          `voidManualEntry` guard rails exactly. */}
                      {entry.isVoided ? (
                        <Badge variant="secondary">{t('voidedBadge')}</Badge>
                      ) : (
                        entry.type !== 'PIECEWORK' &&
                        !entry.voidsEntryId && (
                          <Button size="sm" variant="ghost" onClick={() => setVoidTarget(entry)}>
                            {t('voidEntry')}
                          </Button>
                        )
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={Boolean(voidTarget)} onOpenChange={(o) => { if (!o) { setVoidTarget(null); setVoidNote(''); setVoidError(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('voidEntryConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('voidEntryConfirmDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="void-note">{t('voidNoteLabel')}</Label>
            <Textarea id="void-note" value={voidNote} onChange={(e) => setVoidNote(e.target.value)} rows={2} />
          </div>
          {voidError && <p className="text-sm text-destructive">{voidError}</p>}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{tc('cancel')}</Button>
            </DialogClose>
            <Button variant="destructive" loading={voidEntry.isPending} onClick={handleVoid}>
              {t('voidEntry')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
