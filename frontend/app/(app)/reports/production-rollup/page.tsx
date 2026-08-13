'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMonthlyProductionRollup } from '@/lib/hooks/use-reports';
import { formatEur } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

const fmt = formatEur;

/** COMPLETED production orders grouped by assembly over a date range (defaults to the current month, per the backend). */
export default function MonthlyProductionRollupPage() {
  const t = useTranslations('reports');
  const tc = useTranslations('common');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { data, isLoading } = useMonthlyProductionRollup({ from: from || undefined, to: to || undefined });

  return (
    <div className="space-y-4">
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
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('assembly')}</TableHead>
                <TableHead>{t('ordersCount')}</TableHead>
                <TableHead>{t('unitsProduced')}</TableHead>
                <TableHead>{t('localCost')}</TableHead>
                <TableHead>{t('germanCost')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    {tc('loading')}
                  </TableCell>
                </TableRow>
              ) : !data || data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    {tc('noResults')}
                  </TableCell>
                </TableRow>
              ) : (
                data.map((line) => (
                  <TableRow key={line.assemblyId}>
                    <TableCell>{line.assemblyName}</TableCell>
                    <TableCell>{line.ordersCount}</TableCell>
                    <TableCell>{line.unitsProduced}</TableCell>
                    <TableCell>{fmt(line.totalLocalCostEur)}</TableCell>
                    <TableCell>{fmt(line.totalGermanCostEur)}</TableCell>
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
