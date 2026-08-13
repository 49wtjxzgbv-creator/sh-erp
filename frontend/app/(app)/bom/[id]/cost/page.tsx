'use client';

import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { RefreshCw } from 'lucide-react';
import { useAssemblyCost, useAssembly } from '@/lib/hooks/use-bom';
import { useProduct } from '@/lib/hooks/use-catalog';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { formatEur } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { LoadingBlock } from '@/components/ui/loading-block';
import type { CostBreakdownLine } from '@/lib/api-client/bom';

/** CostBreakdownLine only carries a raw productId/subAssemblyId — resolve to a real name/article/photo, same fix applied to the print view and every other list that showed a raw id. */
function ComponentCell({ line }: { line: CostBreakdownLine }) {
  const { data: product } = useProduct(line.componentType === 'PRODUCT' ? line.productId : undefined);
  const { data: subAssembly } = useAssembly(line.componentType === 'ASSEMBLY' ? line.subAssemblyId : undefined);
  const photoEntityIds = line.componentType === 'PRODUCT' ? (line.productId ? [line.productId] : []) : line.subAssemblyId ? [line.subAssemblyId] : [];
  const { data: photos } = useFilesForEntities(
    line.componentType === 'PRODUCT' ? 'Product' : 'Assembly',
    photoEntityIds,
    line.componentType === 'PRODUCT' ? 'PRODUCT_PHOTO' : 'ASSEMBLY_PHOTO',
  );
  const id = line.componentType === 'PRODUCT' ? line.productId : line.subAssemblyId;
  const label =
    line.componentType === 'PRODUCT'
      ? product
        ? `${product.article} — ${product.name}`
        : line.productId
      : subAssembly
        ? `${subAssembly.name}${subAssembly.article ? ` (${subAssembly.article})` : ''}`
        : line.subAssemblyId;
  return (
    <div className="flex items-center gap-2.5">
      <Avatar src={id ? photos?.[id]?.[0]?.downloadUrl : undefined} size="sm" />
      <span className="max-w-[280px] truncate" title={label}>{label}</span>
    </div>
  );
}

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
            <CardTitle className="text-base">{t('cost')}</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{cost ? formatEur(cost.costPerUnit) : '—'}</CardContent>
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
                <TableCell><ComponentCell line={line} /></TableCell>
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
