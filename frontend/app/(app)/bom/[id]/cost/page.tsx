'use client';

import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { RefreshCw } from 'lucide-react';
import { useAssemblyCost, useAssembly } from '@/lib/hooks/use-bom';
import { toNumber } from '@/lib/api-client/decimal';
import { formatEur } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { LoadingBlock } from '@/components/ui/loading-block';
import { BomComponentCell } from '@/components/domain/bom/bom-component-cell';

export default function AssemblyCostPage() {
  const params = useParams<{ id: string }>();
  const t = useTranslations('bom');
  const tc = useTranslations('common');
  const { data: cost, isLoading, refetch, isFetching } = useAssemblyCost(params.id);
  const { data: assembly } = useAssembly(params.id);

  if (isLoading) {
    return <LoadingBlock />;
  }

  const germanPrice = toNumber(assembly?.germanPriceEur);
  const ourCost = cost?.costPerUnit ?? null;
  const diff = germanPrice !== null && ourCost !== null ? germanPrice - ourCost : null;
  const diffPct = diff !== null && ourCost ? (diff / ourCost) * 100 : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4">
        <Card className="flex-1">
          <CardHeader>
            <CardTitle className="text-base">{t('cost')}</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{cost ? formatEur(cost.costPerUnit) : '—'}</CardContent>
        </Card>
        {germanPrice !== null && (
          <>
            <Card className="flex-1">
              <CardHeader>
                <CardTitle className="text-base">{t('germanPriceEur')}</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold">{formatEur(germanPrice)}</CardContent>
            </Card>
            <Card className="flex-1">
              <CardHeader>
                <CardTitle className="text-base">{t('germanPriceDiff')}</CardTitle>
              </CardHeader>
              <CardContent className={`text-2xl font-semibold ${diff !== null && diff >= 0 ? 'text-success' : 'text-destructive'}`}>
                {diff !== null ? `${diff >= 0 ? '+' : ''}${formatEur(diff)}${diffPct !== null ? ` (${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(0)}%)` : ''}` : '—'}
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">{t('breakdown')}</h2>
        <Button variant="outline" size="sm" loading={isFetching} onClick={() => refetch()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {t('recalculate')}
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('componentType')}</TableHead>
            <TableHead>{t('component')}</TableHead>
            <TableHead>{t('qtyPerUnit')}</TableHead>
            <TableHead>{t('cost')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!cost || cost.breakdown.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                {tc('noResults')}
              </TableCell>
            </TableRow>
          ) : (
            cost.breakdown.map((line, i) => (
              <TableRow key={i}>
                <TableCell>{line.componentType === 'PRODUCT' ? t('componentTypeProduct') : t('componentTypeAssembly')}</TableCell>
                <TableCell><BomComponentCell line={line} /></TableCell>
                <TableCell>{line.qtyPerUnit}</TableCell>
                <TableCell>{formatEur(line.lineCost)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
