'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import { useAssemblyCostVsGermanPrice } from '@/lib/hooks/use-bom';
import { formatEur } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { LoadingBlock } from '@/components/ui/loading-block';
import { BomComponentCell } from '@/components/domain/bom/bom-component-cell';

/**
 * "додай можливість робити такий звіт у будь якій специфікації" (2026-10-17)
 * — the line-by-line cost-vs-German-price breakdown worked out by hand for
 * article 279785 in conversation, now a real page for any assembly. Same
 * card+table+"Перерахувати" shape as cost/page.tsx and weight/page.tsx,
 * with two things those don't need: an own-cost line (labor/packaging/
 * delivery/other has no German equivalent at all) and a staleness warning
 * (the saved germanPriceEur can silently drift out of sync with a fresh
 * recalculation — see the backend's own header comment on
 * compareCostToGermanPrice).
 */
export default function AssemblyCostVsGermanPricePage() {
  const params = useParams<{ id: string }>();
  const t = useTranslations('bom');
  const tc = useTranslations('common');
  const { data, isLoading, refetch, isFetching } = useAssemblyCostVsGermanPrice(params.id);

  if (isLoading) {
    return <LoadingBlock />;
  }
  if (!data) {
    return null;
  }

  const diff = data.storedGermanPriceEur !== null ? data.storedGermanPriceEur - data.costPerUnit : null;
  const diffPct = diff !== null && data.costPerUnit ? (diff / data.costPerUnit) * 100 : null;
  const ownCost = data.ownLaborCost + data.ownPackagingCost + data.ownDeliveryCost + data.ownOtherCost;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4">
        <Card className="flex-1">
          <CardHeader>
            <CardTitle className="text-base">{t('cost')}</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{formatEur(data.costPerUnit)}</CardContent>
        </Card>
        <Card className="flex-1">
          <CardHeader>
            <CardTitle className="text-base">{t('germanPriceEur')}</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {data.storedGermanPriceEur !== null ? formatEur(data.storedGermanPriceEur) : '—'}
          </CardContent>
        </Card>
        {diff !== null && (
          <Card className="flex-1">
            <CardHeader>
              <CardTitle className="text-base">{t('germanPriceDiff')}</CardTitle>
            </CardHeader>
            <CardContent className={`text-2xl font-semibold ${diff >= 0 ? 'text-success' : 'text-destructive'}`}>
              {`${diff >= 0 ? '+' : ''}${formatEur(diff)}${diffPct !== null ? ` (${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(0)}%)` : ''}`}
            </CardContent>
          </Card>
        )}
      </div>

      {data.isStoredGermanPriceStale && (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div>
            <p className="font-medium">{t('germanPriceStale')}</p>
            <p className="text-muted-foreground">{t('germanPriceStaleHint', { fresh: formatEur(data.freshGermanPricePerUnit) })}</p>
          </div>
        </div>
      )}

      {ownCost > 0 && (
        <p className="text-sm text-muted-foreground">
          {t('componentTypeOwn')}: <span className="font-medium text-foreground">{formatEur(ownCost)}</span> — {t('ownCostNoGermanEquivalent')}
        </p>
      )}

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
            <TableHead>{t('germanPriceEur')}</TableHead>
            <TableHead>{t('germanPriceDiff')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.lines.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                {tc('noResults')}
              </TableCell>
            </TableRow>
          ) : (
            data.lines.map((line, i) => (
              <TableRow key={i}>
                <TableCell>{line.componentType === 'PRODUCT' ? t('componentTypeProduct') : t('componentTypeAssembly')}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <BomComponentCell line={line} />
                    {line.componentType === 'ASSEMBLY' && line.subAssemblyId && (
                      <Link href={`/bom/${line.subAssemblyId}/cost-vs-german-price`} className="shrink-0 text-xs text-primary hover:underline">
                        {t('viewSubAssembly')}
                      </Link>
                    )}
                  </div>
                </TableCell>
                <TableCell>{line.qtyPerUnit}</TableCell>
                <TableCell>{formatEur(line.lineCost)}</TableCell>
                <TableCell>{line.germanPriceMissing ? <Badge variant="warning">{t('germanPriceNotSet')}</Badge> : formatEur(line.lineGermanPrice)}</TableCell>
                <TableCell className={line.germanPriceMissing ? undefined : line.lineDelta >= 0 ? 'text-success' : 'text-destructive'}>
                  {line.germanPriceMissing ? '—' : `${line.lineDelta >= 0 ? '+' : ''}${formatEur(line.lineDelta)}`}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
