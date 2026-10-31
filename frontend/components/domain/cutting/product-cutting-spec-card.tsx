'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useProductCuttingSpec, useUpsertProductCuttingSpec, useDeleteProductCuttingSpec } from '@/lib/hooks/use-cutting';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { toNumber } from '@/lib/api-client/decimal';
import type { CuttingStockKind } from '@/lib/api-client/cutting';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

export interface ProductCuttingSpecCardProps {
  productId: string;
  readOnly?: boolean;
}

/**
 * Розкрій (2026-10-31) — opt-in "this product is cut from standard-length
 * stock" toggle on the product edit page. A standalone card with its own
 * save action (not wired into ProductForm's own big submit), same pattern
 * as other per-concern cards on an entity's edit page (photo, documents).
 */
export function ProductCuttingSpecCard({ productId, readOnly }: ProductCuttingSpecCardProps) {
  const t = useTranslations('cutting');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const { data: spec, isLoading } = useProductCuttingSpec(productId);
  const upsert = useUpsertProductCuttingSpec(productId);
  const del = useDeleteProductCuttingSpec(productId);

  const [enabled, setEnabled] = useState(false);
  const [kind, setKind] = useState<CuttingStockKind>('BAR');
  const [stockLengthCm, setStockLengthCm] = useState('');
  const [stockWidthCm, setStockWidthCm] = useState('');
  const [kerfMm, setKerfMm] = useState('3');
  const [minRemnantLengthCm, setMinRemnantLengthCm] = useState('');
  const [minRemnantAreaCm2, setMinRemnantAreaCm2] = useState('');
  const [allowRotation, setAllowRotation] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!spec) return;
    setEnabled(true);
    setKind(spec.kind);
    setStockLengthCm(String(toNumber(spec.stockLengthCm) ?? ''));
    setStockWidthCm(spec.stockWidthCm != null ? String(toNumber(spec.stockWidthCm) ?? '') : '');
    setKerfMm(String(toNumber(spec.kerfMm) ?? '3'));
    setMinRemnantLengthCm(spec.minRemnantLengthCm != null ? String(toNumber(spec.minRemnantLengthCm) ?? '') : '');
    setMinRemnantAreaCm2(spec.minRemnantAreaCm2 != null ? String(toNumber(spec.minRemnantAreaCm2) ?? '') : '');
    setAllowRotation(spec.allowRotation);
  }, [spec]);

  async function handleToggle(next: boolean) {
    setEnabled(next);
    if (!next && spec) {
      setError(null);
      try {
        await del.mutateAsync();
      } catch (err) {
        setError(apiErrorMessage(err, tc('error')));
        setEnabled(true);
      }
    }
  }

  async function handleSave() {
    setError(null);
    setSaved(false);
    const length = Number(stockLengthCm);
    if (!length || length <= 0) {
      setError(t('cutDimensionHint'));
      return;
    }
    if (kind === 'SHEET' && (!stockWidthCm || Number(stockWidthCm) <= 0)) {
      setError(t('stockWidthLabel'));
      return;
    }
    try {
      await upsert.mutateAsync({
        kind,
        stockLengthCm: length,
        stockWidthCm: kind === 'SHEET' ? Number(stockWidthCm) : undefined,
        kerfMm: kerfMm ? Number(kerfMm) : undefined,
        minRemnantLengthCm: minRemnantLengthCm ? Number(minRemnantLengthCm) : undefined,
        minRemnantAreaCm2: minRemnantAreaCm2 ? Number(minRemnantAreaCm2) : undefined,
        allowRotation,
      });
      setSaved(true);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  if (isLoading) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('specSectionTitle')}</CardTitle>
        <CardDescription>{t('specEnableDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Switch id="cutting-enabled" checked={enabled} onCheckedChange={handleToggle} disabled={readOnly} />
          <Label htmlFor="cutting-enabled">{t('specEnableLabel')}</Label>
        </div>

        {enabled && (
          <fieldset disabled={readOnly} className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t('kindLabel')}</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as CuttingStockKind)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BAR">{t('kindBar')}</SelectItem>
                  <SelectItem value="SHEET">{t('kindSheet')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{kind === 'BAR' ? t('stockLengthLabelBar') : t('stockLengthLabelSheet')}</Label>
              <Input type="number" step="any" min={0} value={stockLengthCm} onChange={(e) => setStockLengthCm(e.target.value)} />
            </div>
            {kind === 'SHEET' && (
              <div className="space-y-1.5">
                <Label>{t('stockWidthLabel')}</Label>
                <Input type="number" step="any" min={0} value={stockWidthCm} onChange={(e) => setStockWidthCm(e.target.value)} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>{t('kerfLabel')}</Label>
              <Input type="number" step="any" min={0} value={kerfMm} onChange={(e) => setKerfMm(e.target.value)} />
            </div>
            {kind === 'BAR' ? (
              <div className="space-y-1.5">
                <Label>{t('minRemnantLengthLabel')}</Label>
                <Input type="number" step="any" min={0} value={minRemnantLengthCm} onChange={(e) => setMinRemnantLengthCm(e.target.value)} />
                <p className="text-xs text-muted-foreground">{t('minRemnantLengthHint')}</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>{t('minRemnantAreaLabel')}</Label>
                <Input type="number" step="any" min={0} value={minRemnantAreaCm2} onChange={(e) => setMinRemnantAreaCm2(e.target.value)} />
              </div>
            )}
            {kind === 'SHEET' && (
              <div className="flex items-center gap-3 pt-6">
                <Switch id="allow-rotation" checked={allowRotation} onCheckedChange={setAllowRotation} />
                <Label htmlFor="allow-rotation">{t('allowRotationLabel')}</Label>
              </div>
            )}

            <div className="sm:col-span-2">
              {!readOnly && (
                <Button type="button" onClick={handleSave} loading={upsert.isPending}>
                  {t('saveSpec')}
                </Button>
              )}
              {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
              {saved && !error && <p className="mt-2 text-sm text-success">{t('specSaved')}</p>}
            </div>
          </fieldset>
        )}
      </CardContent>
    </Card>
  );
}
