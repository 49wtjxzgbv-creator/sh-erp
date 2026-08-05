'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePayrollSummary } from '@/lib/hooks/use-hr';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

/**
 * Per-employee totals by entry type, plus a QC-defect count
 * cross-referenced through each employee's assigned production orders
 * (Phase 1 §6.5, confirmed from payroll.service.ts#getPayrollSummaryReport).
 * All fields are computed JSON numbers, not DecimalString — see
 * lib/api-client/hr.ts's PayrollSummaryLine comment.
 */
export default function PayrollSummaryPage() {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { data, isLoading } = usePayrollSummary({ from: from || undefined, to: to || undefined });

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{t('payrollSummary')}</h2>
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="space-y-1.5">
            <Label htmlFor="from">{t('fromDate')}</Label>
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="to">{t('toDate')}</Label>
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('summaryByEmployee')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('employee')}</TableHead>
                <TableHead>{t('entryTypePIECEWORK')}</TableHead>
                <TableHead>{t('entryTypeADVANCE')}</TableHead>
                <TableHead>{t('entryTypeBONUS')}</TableHead>
                <TableHead>{t('entryTypePENALTY')}</TableHead>
                <TableHead>{t('netTotal')}</TableHead>
                <TableHead>{t('defectCount')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                    {tc('loading')}
                  </TableCell>
                </TableRow>
              ) : !data || data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                    {tc('noResults')}
                  </TableCell>
                </TableRow>
              ) : (
                data.map((line) => (
                  <TableRow key={line.employeeId}>
                    <TableCell>{line.employeeName}</TableCell>
                    <TableCell>{line.piecework.toFixed(2)}</TableCell>
                    <TableCell>{line.advances.toFixed(2)}</TableCell>
                    <TableCell>{line.bonuses.toFixed(2)}</TableCell>
                    <TableCell>{line.penalties.toFixed(2)}</TableCell>
                    <TableCell className="font-medium">{line.netTotal.toFixed(2)}</TableCell>
                    <TableCell>
                      {line.defectCount > 0 ? (
                        <Badge variant="warning">{line.defectCount}</Badge>
                      ) : (
                        line.defectCount
                      )}
                    </TableCell>
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
