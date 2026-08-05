'use client';

import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { RefreshCw } from 'lucide-react';
import { useAssemblyCost } from '@/lib/hooks/use-bom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { LoadingBlock } from '@/components/ui/loading-block';

export default function AssemblyCostPage() {
  const params = useParams<{ id: string }>();
  const t = useTranslations('bom');
  const tc = useTranslations('common');
  const { data: cost, isLoading, refetch, isFetching } = useAssemblyCost(params.id);

  if (isLoading) {
    return <LoadingBlock />;
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-4">
        <Card className="flex-1">
          <CardHeader>
            <CardTitle className="text-base">{t('localCost')}</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{cost?.localCostPerUnit.toFixed(2)}</CardContent>
        </Card>
        <Card className="flex-1">
          <CardHeader>
            <CardTitle className="text-base">{t('germanCost')}</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{cost?.germanCostPerUnit.toFixed(2)}</CardContent>
        </Card>
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
            <TableHead>{t('localCost')}</TableHead>
            <TableHead>{t('germanCost')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!cost || cost.breakdown.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                {tc('noResults')}
              </TableCell>
            </TableRow>
          ) : (
            cost.breakdown.map((line, i) => (
              <TableRow key={i}>
                <TableCell>{line.componentType === 'PRODUCT' ? t('componentTypeProduct') : t('componentTypeAssembly')}</TableCell>
                <TableCell className="max-w-[240px] truncate">{line.productId ?? line.subAssemblyId}</TableCell>
                <TableCell>{line.qtyPerUnit}</TableCell>
                <TableCell>{line.lineLocalCost.toFixed(2)}</TableCell>
                <TableCell>{line.lineGermanCost.toFixed(2)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
