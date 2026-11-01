'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Scissors } from 'lucide-react';
import {
  useProductCuttingSpec,
  useUpsertProductCuttingSpec,
  useDeleteProductCuttingSpec,
  useExtractDefaultCutShape,
  usePreviewCuttingPlan,
} from '@/lib/hooks/use-cutting';
import { useWarehouses } from '@/lib/hooks/use-inventory';
import { useHasPermission } from '@/lib/hooks/use-roles';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { toNumber } from '@/lib/api-client/decimal';
import type { CuttingStockKind } from '@/lib/api-client/cutting';
import { uploadFile } from '@/lib/api-client/files';
import type { MatchedBomLine } from '@/lib/api-client/ai';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

const STEP_EXTENSION = /\.(step|stp)$/i;

export interface ProductCuttingSpecCardProps {
  productId: string;
  readOnly?: boolean;
}

/**
 * Розкрій (2026-10-31) — opt-in "this product is cut from standard-length
 * stock" toggle on the product edit page. A standalone card with its own
 * save action (not wired into ProductForm's own big submit), same pattern
 * as other per-concern cards on an entity's edit page (photo, documents).
 *
 * Direct-product cutting (2026-11-01): extended with (1) this product's own
 * default piece-to-cut shape — manual length×width or a STEP-upload-derived
 * polygon, saved onto the same ProductCuttingSpec row — and (2) a
 * "Порахувати розкрій" action that runs a cutting plan directly against
 * this product, no assembly/BOM involved.
 */
export function ProductCuttingSpecCard({ productId, readOnly }: ProductCuttingSpecCardProps) {
  const t = useTranslations('cutting');
  const tBom = useTranslations('bom');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const router = useRouter();
  const canWrite = useHasPermission('cutting:write');
  const { data: spec, isLoading } = useProductCuttingSpec(productId);
  const upsert = useUpsertProductCuttingSpec(productId);
  const del = useDeleteProductCuttingSpec(productId);
  const extractShape = useExtractDefaultCutShape(productId);
  const preview = usePreviewCuttingPlan();
  const { data: warehouses } = useWarehouses();
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Direct-product default cut shape
  const [defaultCutLengthCm, setDefaultCutLengthCm] = useState('');
  const [defaultCutWidthCm, setDefaultCutWidthCm] = useState('');
  const [defaultShapePolygon, setDefaultShapePolygon] = useState<{ outerCm: [number, number][]; holesCm: [number, number][][] } | null>(null);
  const [shapeCandidates, setShapeCandidates] = useState<MatchedBomLine[] | null>(null);
  const [shapeError, setShapeError] = useState<string | null>(null);

  // Direct-product "Порахувати розкрій"
  const [qty, setQty] = useState('');
  const [calcWarehouseId, setCalcWarehouseId] = useState<string | undefined>(undefined);
  const [calcError, setCalcError] = useState<string | null>(null);

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
    setDefaultCutLengthCm(spec.defaultCutLengthCm != null ? String(toNumber(spec.defaultCutLengthCm) ?? '') : '');
    setDefaultCutWidthCm(spec.defaultCutWidthCm != null ? String(toNumber(spec.defaultCutWidthCm) ?? '') : '');
    setDefaultShapePolygon(spec.defaultCutShapePolygon ?? null);
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
        defaultCutLengthCm: defaultCutLengthCm ? Number(defaultCutLengthCm) : undefined,
        defaultCutWidthCm: defaultCutWidthCm ? Number(defaultCutWidthCm) : undefined,
        defaultCutShapePolygon: defaultShapePolygon ?? undefined,
      });
      setSaved(true);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  function adoptShapeLine(line: MatchedBomLine) {
    if (line.lengthCm != null) setDefaultCutLengthCm(String(line.lengthCm));
    if (line.widthCm != null) setDefaultCutWidthCm(String(line.widthCm));
    setDefaultShapePolygon(line.shapePolygon ?? null);
    setShapeCandidates(null);
  }

  async function handleUploadStep(file: File) {
    setShapeError(null);
    setShapeCandidates(null);
    try {
      const fileAsset = await uploadFile(file, { domain: 'PRODUCT_DOCUMENT', entityType: 'Product', entityId: productId });
      const result = await extractShape.mutateAsync(fileAsset.id);
      if (result.lines.length === 0) {
        setShapeError(t('shapeExtractionEmpty'));
      } else if (result.lines.length === 1) {
        adoptShapeLine(result.lines[0]);
      } else {
        setShapeCandidates(result.lines);
      }
    } catch (err) {
      setShapeError(apiErrorMessage(err, tc('error')));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleCalculate() {
    const qtyNum = Number(qty);
    if (!qtyNum || qtyNum <= 0) return;
    setCalcError(null);
    try {
      const plan = await preview.mutateAsync({ productId, qty: qtyNum, warehouseId: calcWarehouseId });
      router.push(`/cutting/${plan.id}`);
    } catch (err) {
      setCalcError(apiErrorMessage(err, tc('error')));
    }
  }

  if (isLoading) return null;

  const hasSavedShape = spec?.defaultCutLengthCm != null;

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
          <>
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
            </fieldset>

            <div className="space-y-2 rounded-md border border-border p-3">
              <Label className="text-sm">{t('defaultShapeSectionTitle')}</Label>
              <p className="text-xs text-muted-foreground">{t('defaultShapeSectionDescription')}</p>
              <fieldset disabled={readOnly} className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>{t('cutLengthLabel')}</Label>
                  <Input type="number" step="any" min={0} value={defaultCutLengthCm} onChange={(e) => setDefaultCutLengthCm(e.target.value)} />
                </div>
                {kind === 'SHEET' && (
                  <div className="space-y-1.5">
                    <Label>{t('cutWidthLabel')}</Label>
                    <Input type="number" step="any" min={0} value={defaultCutWidthCm} onChange={(e) => setDefaultCutWidthCm(e.target.value)} />
                  </div>
                )}
              </fieldset>
              {!readOnly && (
                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".step,.stp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleUploadStep(file);
                    }}
                  />
                  <Button type="button" variant="outline" size="sm" loading={extractShape.isPending} onClick={() => fileInputRef.current?.click()}>
                    {t('uploadStepLabel')}
                  </Button>
                  {defaultShapePolygon && <Badge variant="secondary">{t('shapeFromStepBadge')}</Badge>}
                </div>
              )}
              {shapeError && <p className="text-xs text-destructive">{shapeError}</p>}
              {shapeCandidates && (
                <div className="space-y-1.5 rounded-md bg-muted p-2">
                  <p className="text-xs font-medium">{t('pickExtractedShapeTitle')}</p>
                  {shapeCandidates.map((line, i) => (
                    <Button key={i} type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => adoptShapeLine(line)}>
                      {line.rawName} — {line.dimensions ?? '—'}
                    </Button>
                  ))}
                </div>
              )}
            </div>

            {!readOnly && (
              <div>
                <Button type="button" onClick={handleSave} loading={upsert.isPending}>
                  {t('saveSpec')}
                </Button>
                {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
                {saved && !error && <p className="mt-2 text-sm text-success">{t('specSaved')}</p>}
              </div>
            )}

            {hasSavedShape && canWrite && (
              <div className="space-y-2 rounded-md border border-border p-3">
                <Label className="text-sm">{t('calculateCuttingDialogTitle')}</Label>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="direct-cutting-qty">{t('calculateCuttingQtyLabel')}</Label>
                    <Input id="direct-cutting-qty" type="number" step="any" min={0} value={qty} onChange={(e) => setQty(e.target.value)} className="w-28" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{tBom('warehouse')}</Label>
                    <Select value={calcWarehouseId} onValueChange={setCalcWarehouseId}>
                      <SelectTrigger className="w-44">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        {warehouses?.map((w) => (
                          <SelectItem key={w.id} value={w.id}>
                            {w.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="button" onClick={handleCalculate} loading={preview.isPending} disabled={!qty}>
                    <Scissors className="mr-2 h-4 w-4" />
                    {t('calculateCutting')}
                  </Button>
                </div>
                {calcError && <p className="text-sm text-destructive">{calcError}</p>}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
