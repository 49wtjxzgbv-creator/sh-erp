'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRecordPayrollEntry, usePayrollEntries } from '@/lib/hooks/use-hr';
import { EmployeePicker } from '@/components/domain/hr/employee-picker';
import { useApiErrorMessage } from '@/lib/api-error-message';
import type { ManualPayrollEntryType, PayrollEntryType } from '@/lib/api-client/hr';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

const PAGE_SIZE = 50;

export default function PayrollPage() {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const recordEntry = useRecordPayrollEntry();

  const [employeeId, setEmployeeId] = useState<string | undefined>(undefined);
  const [type, setType] = useState<ManualPayrollEntryType>('ADVANCE');
  const [amount, setAmount] = useState('');
  const [entryDate, setEntryDate] = useState('');
  const [comment, setComment] = useState('');
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
      });
      setAmount('');
      setComment('');
      setSuccess(true);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
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
                <TableHead>{t('comment')}</TableHead>
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
                data.items.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{t(`entryType${entry.type}`)}</TableCell>
                    <TableCell>{entry.amount}</TableCell>
                    <TableCell>{new Date(entry.entryDate).toLocaleDateString()}</TableCell>
                    <TableCell className="max-w-[220px] truncate" title={entry.comment ?? ''}>{entry.comment ?? '—'}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
