'use client';

import { useTranslations } from 'next-intl';
import { useWarehouseValuation } from '@/lib/hooks/use-reports';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

function fmt(n: number) {
  return n.toFixed(2);
}

/** Admin-only (reports:valuation) — all 5 legacy price fields, grouped by category, plus a grand total row. */
export default function WarehouseValuationPage() {
  const t = useTranslations('reports');
  const tc = useTranslations('common');
  const { data, isLoading } = useWarehouseValuation();

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('category')}</TableHead>
                <TableHead>{t('productCount')}</TableHead>
                <TableHead>{t('localExclVat')}</TableHead>
                <TableHead>{t('localInclVat')}</TableHead>
                <TableHead>{t('germanExclVat')}</TableHead>
                <TableHead>{t('germanInclVat')}</TableHead>
                <TableHead>{t('sellValue')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    {tc('loading')}
                  </TableCell>
                </TableRow>
              ) : !data || data.byCategory.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    {tc('noResults')}
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {data.byCategory.map((line) => (
                    <TableRow key={line.category ?? '__none'}>
                      <TableCell>{line.category ?? t('uncategorized')}</TableCell>
                      <TableCell>{line.productCount}</TableCell>
                      <TableCell>{fmt(line.totalLocalExclVat)}</TableCell>
                      <TableCell>{fmt(line.totalLocalInclVat)}</TableCell>
                      <TableCell>{fmt(line.totalGermanExclVat)}</TableCell>
                      <TableCell>{fmt(line.totalGermanInclVat)}</TableCell>
                      <TableCell>{fmt(line.totalSellEur)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 border-border font-medium">
                    <TableCell>{t('grandTotal')}</TableCell>
                    <TableCell>{data.grandTotal.productCount}</TableCell>
                    <TableCell>{fmt(data.grandTotal.totalLocalExclVat)}</TableCell>
                    <TableCell>{fmt(data.grandTotal.totalLocalInclVat)}</TableCell>
                    <TableCell>{fmt(data.grandTotal.totalGermanExclVat)}</TableCell>
                    <TableCell>{fmt(data.grandTotal.totalGermanInclVat)}</TableCell>
                    <TableCell>{fmt(data.grandTotal.totalSellEur)}</TableCell>
                  </TableRow>
                </>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
