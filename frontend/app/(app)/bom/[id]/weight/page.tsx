'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import { useAssemblyWeight } from '@/lib/hooks/use-bom';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { isGlbFile } from '@/components/domain/files/entity-documents-field';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { LoadingBlock } from '@/components/ui/loading-block';
import { BomComponentCell } from '@/components/domain/bom/bom-component-cell';
import type { WeightBreakdownLine } from '@/lib/api-client/bom';

/**
 * "а якщо є завантажений glb файл специфікації" (2026-10-08): a missing
 * `unitWeightKg` (Product.weightPerUnitKg never set) is common for
 * fasteners/standard parts, and the user agreed this view should point at
 * the fix, not just flag the gap — if that specific product happens to have
 * its own `.glb` attached, link straight to its edit page where
 * `ModelWeightCalculator` (product-form.tsx) can compute it on the spot.
 * No link at all if there's no model to compute from; just the plain
 * "not set" label.
 */
function WeightCell({ line }: { line: WeightBreakdownLine }) {
  const t = useTranslations('bom');
  const checkGlb = line.componentType === 'PRODUCT' && line.unitWeightKg == null && Boolean(line.productId);
  const { data: byEntity } = useFilesForEntities('Product', checkGlb && line.productId ? [line.productId] : [], 'PRODUCT_DOCUMENT');

  if (line.unitWeightKg != null) {
    return (
      <span className="inline-flex items-center gap-1.5">
        {line.unitWeightKg.toFixed(3)}
        {!line.complete && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />}
      </span>
    );
  }

  const hasGlb = checkGlb && line.productId ? (byEntity?.[line.productId] ?? []).some((f) => isGlbFile(f.originalName)) : false;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-muted-foreground">{t('weightNotSet')}</span>
      {hasGlb && line.productId && (
        <Link href={`/catalog/${line.productId}`} className="text-xs text-primary underline underline-offset-2">
          {t('weightCalculateFromModel')}
        </Link>
      )}
    </span>
  );
}

export default function AssemblyWeightPage() {
  const params = useParams<{ id: string }>();
  const t = useTranslations('bom');
  const tc = useTranslations('common');
  const { data: weight, isLoading, refetch, isFetching } = useAssemblyWeight(params.id);

  if (isLoading) {
    return <LoadingBlock />;
  }

  return (
    <div className="space-y-4">
      <Card className="max-w-xs">
        <CardHeader>
          <CardTitle className="text-base">{t('weight')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <p className="text-2xl font-semibold">{weight ? `${weight.weightPerUnitKg.toFixed(3)} ${t('kg')}` : '—'}</p>
          {weight && !weight.complete && (
            <p className="flex items-center gap-1.5 text-xs text-warning">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {t('weightIncompleteWarning')}
            </p>
          )}
        </CardContent>
      </Card>

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
            <TableHead>{t('unitWeightKg')}</TableHead>
            <TableHead>{t('lineWeightKg')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!weight || weight.breakdown.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                {tc('noResults')}
              </TableCell>
            </TableRow>
          ) : (
            weight.breakdown.map((line, i) => (
              <TableRow key={i}>
                <TableCell>{line.componentType === 'PRODUCT' ? t('componentTypeProduct') : t('componentTypeAssembly')}</TableCell>
                <TableCell><BomComponentCell line={line} /></TableCell>
                <TableCell>{line.qtyPerUnit}</TableCell>
                <TableCell><WeightCell line={line} /></TableCell>
                <TableCell>{line.lineWeightKg.toFixed(3)} {t('kg')}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
