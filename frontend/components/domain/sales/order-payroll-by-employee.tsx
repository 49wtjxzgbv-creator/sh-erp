'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useOrderPayrollByEmployee } from '@/lib/hooks/use-sales';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { formatEur } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { LoadingBlock } from '@/components/ui/loading-block';
import { EmptyState } from '@/components/ui/empty-state';
import { Users } from 'lucide-react';

/**
 * "По працівниках" tab on План виробництва's order detail (2026-08-30 user
 * request — "хто скільки заробив і хто скільки чого зробив"): one card per
 * employee who earned PIECEWORK pay on this order, name + total up top,
 * their own article/qty/amount breakdown always visible below (same
 * "no click needed" convention as the payroll fund's own estimated-by-
 * article table — see PayrollFundWidget's 2026-08-30 follow-up).
 */
export function OrderPayrollByEmployee({ orderId }: { orderId: string }) {
  const t = useTranslations('sales');
  const { data: lines, isLoading } = useOrderPayrollByEmployee(orderId);
  const assemblyIds = useMemo(() => {
    const ids = new Set<string>();
    for (const line of lines ?? []) for (const a of line.byArticle) if (a.assemblyId) ids.add(a.assemblyId);
    return Array.from(ids);
  }, [lines]);
  const { data: photosByAssembly } = useFilesForEntities('Assembly', assemblyIds, 'ASSEMBLY_PHOTO');

  if (isLoading) return <LoadingBlock />;
  if (!lines || lines.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <EmptyState icon={Users} title={t('payrollByEmployeeEmpty')} />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {lines.map((line) => (
        <Card key={line.employeeId}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">{line.employeeName}</CardTitle>
            <p className="text-sm font-medium">{formatEur(line.totalEarned)}</p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('payrollFundArticle')}</TableHead>
                  <TableHead>{t('payrollFundUnitsProduced')}</TableHead>
                  <TableHead>{t('payrollFundEarned')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {line.byArticle.map((a) => (
                  <TableRow key={a.assemblyId ?? 'general'}>
                    <TableCell>
                      {a.assemblyId ? (
                        <div className="flex items-center gap-2">
                          <Avatar src={photosByAssembly?.[a.assemblyId]?.[0]?.downloadUrl} size="sm" />
                          <div className="min-w-0">
                            {a.article && <p className="truncate text-xs text-muted-foreground">{a.article}</p>}
                            <p className="max-w-[240px] truncate text-sm" title={a.assemblyName ?? undefined}>
                              {a.assemblyName}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">{t('payrollFundGeneralWork')}</span>
                      )}
                    </TableCell>
                    <TableCell>{a.unitsProduced || '—'}</TableCell>
                    <TableCell>{formatEur(a.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
