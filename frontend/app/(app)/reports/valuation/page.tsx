'use client';

import { useTranslations } from 'next-intl';
import { useWarehouseValuation } from '@/lib/hooks/use-reports';
import { formatEur } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

const fmt = formatEur;

/** Admin-only (reports:valuation) — qty * sellPriceEur, grouped by category, plus a grand total row. sellPriceEur is the one price every calculation in this app is pinned to; the other legacy price fields (local/German, excl/incl VAT) are informational only and no longer appear in this report's totals. */
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
                <TableHead>{t('sellValue')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                    {tc('loading')}
                  </TableCell>
                </TableRow>
              ) : !data || data.byCategory.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                    {tc('noResults')}
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {data.byCategory.map((line) => (
                    <TableRow key={line.category ?? '__none'}>
                      <TableCell>{line.category ?? t('uncategorized')}</TableCell>
                      <TableCell>{line.productCount}</TableCell>
                      <TableCell>{fmt(line.totalValue)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 border-border font-medium">
                    <TableCell>{t('grandTotal')}</TableCell>
                    <TableCell>{data.grandTotal.productCount}</TableCell>
                    <TableCell>{fmt(data.grandTotal.totalValue)}</TableCell>
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
