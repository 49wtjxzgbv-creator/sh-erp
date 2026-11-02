'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { SheetStockDiagram, BarStockDiagram } from '@/components/domain/cutting/cutting-plan-detail';
import { toNumber } from '@/lib/api-client/decimal';
import { supplierPortalApi } from '@/lib/supplier-portal/api';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { isGlbFile } from '@/components/domain/files/entity-documents-field';
import type { FileAssetWithUrl } from '@/lib/api-client/files';
import type { SupplierCatalogEntry } from '@/lib/api-client/supplier-catalog';
import { previewSupplierCutting, type SupplierCuttingResult } from '@/lib/api-client/supplier-cutting';
import { CuttingLineRow, type CuttingLineRowState, type CuttingPickerItem } from './cutting-line-row';

interface StockPickerRow {
  itemId: string;
  article: string;
  productName: string;
  cuttingSpec: SupplierCatalogEntry['cuttingSpec'];
  files: FileAssetWithUrl[];
  photoUrl: string | null;
}

/** "воно ж розміри має витягувати для розкрою з файлів глб" (2026-11-03) — same resolution CuttingLineRow needs for its GLB-dimension fallback, just the plain `downloadUrl` (not the AR-optimized variant chain `resolveArGlbUrl` elsewhere in this app uses) since this is a one-off measurement, not an AR render — same convention already established by `PackagingDimensionsFromModelCalculator` in assembly-form.tsx. */
function resolveGlbUrl(files: FileAssetWithUrl[]): string | null {
  return files.find((f) => isGlbFile(f.originalName))?.downloadUrl ?? null;
}

function newLine(partial: Partial<CuttingLineRowState> = {}): CuttingLineRowState {
  return { key: crypto.randomUUID(), label: '', qty: '1', cutLengthCm: '', cutWidthCm: '', cutShapePolygon: null, ...partial };
}

/**
 * "розкрій має могти робити постачальник сам собі" (2026-11-02) — the
 * supplier's own self-service nesting tool: own sheet/bar dims, parts
 * picked freely from the catalog OR their own open orders OR typed in
 * manually. Fully stateless on the backend — nothing here is ever saved
 * to our own data, so there's no detail route, only this one page.
 */
export default function SupplierPortalCuttingPage() {
  const t = useTranslations('supplierPortal');
  const tCutting = useTranslations('cutting');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();

  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<'SHEET' | 'BAR'>('SHEET');
  const [stockLengthCm, setStockLengthCm] = useState('');
  const [stockWidthCm, setStockWidthCm] = useState('');
  const [kerfMm, setKerfMm] = useState('3');
  const [allowRotation, setAllowRotation] = useState(true);
  const [lines, setLines] = useState<CuttingLineRowState[]>([newLine()]);

  const [catalog, setCatalog] = useState<SupplierCatalogEntry[]>([]);
  const [stockItems, setStockItems] = useState<StockPickerRow[]>([]);

  const [result, setResult] = useState<SupplierCuttingResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPickerData = useCallback(async () => {
    try {
      const [catalogRes, stockRes] = await Promise.all([
        supplierPortalApi.get<{ items: SupplierCatalogEntry[] }>('supplier-portal/catalog'),
        supplierPortalApi.get<{ items: StockPickerRow[] }>('supplier-portal/stock'),
      ]);
      setCatalog(catalogRes.items);
      setStockItems(stockRes.items);
    } catch {
      setCatalog([]);
      setStockItems([]);
    }
  }, []);

  useEffect(() => {
    loadPickerData();
  }, [loadPickerData]);

  function updateLine(key: string, patch: Partial<CuttingLineRowState>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  /**
   * "material.stockLengthCm must not be less than 0.01" (2026-11-03) — the
   * raw class-validator message leaking straight to the UI untranslated
   * (`useApiErrorMessage`'s own documented limitation: a validation string
   * has no stable `code` to translate against, see its header comment).
   * Validating client-side before the request ever goes out means the
   * supplier sees a normal Ukrainian message instead of that English DTO
   * string — the real fix is never letting the request leave with a zero
   * dimension, not translating the backend's rejection of it.
   */
  function validateBeforeSubmit(): string | null {
    const stockLengthOk = Number(stockLengthCm || 0) > 0;
    const stockWidthOk = kind !== 'SHEET' || Number(stockWidthCm || 0) > 0;
    if (!stockLengthOk || !stockWidthOk) return t('cuttingErrorStockDims');

    const linesOk = lines.every((l) => Number(l.qty || 0) > 0 && Number(l.cutLengthCm || 0) > 0 && (kind !== 'SHEET' || Number(l.cutWidthCm || 0) > 0));
    if (!linesOk) return t('cuttingErrorLineDims');

    return null;
  }

  async function handleSubmit() {
    setError(null);
    setResult(null);
    const validationError = validateBeforeSubmit();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    try {
      const res = await previewSupplierCutting({
        material: {
          label: label || (kind === 'SHEET' ? t('cuttingDefaultSheetLabel') : t('cuttingDefaultBarLabel')),
          kind,
          stockLengthCm: Number(stockLengthCm || 0),
          stockWidthCm: kind === 'SHEET' ? Number(stockWidthCm || 0) : undefined,
          kerfMm: Number(kerfMm || 0),
          allowRotation,
        },
        lines: lines.map((l) => ({
          label: l.label || undefined,
          qty: Number(l.qty || 0),
          cutLengthCm: Number(l.cutLengthCm || 0),
          cutWidthCm: kind === 'SHEET' ? Number(l.cutWidthCm || 0) : undefined,
          cutShapePolygon: l.cutShapePolygon ?? undefined,
        })),
      });
      setResult(res);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    } finally {
      setSubmitting(false);
    }
  }

  function downloadDxf(dxf: string, index: number) {
    const blob = new Blob([dxf], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${label || 'розкрій'}-${index + 1}.dxf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // "деталі розкрою назва має бути випадаюче меню і пошук коли починаємо вводити
  // перші символи" (2026-11-02) — one combined, pre-built search index for every
  // row's name field (see CuttingLineRow's own EntityCombobox), catalog entries
  // and open-order items alike. EVERY item is searchable by name regardless of
  // whether it has a saved cutting spec (2026-11-02 follow-up — "пише що нічого
  // не знайдено": restricting the index to only cuttingSpec-bearing items made
  // the search find nothing at all for a company that hasn't configured any
  // yet, which is the common case; a spec is just an optional dimension
  // pre-fill, not a requirement to be found by name at all).
  const pickerItems = useMemo<CuttingPickerItem[]>(() => {
    const fromCatalog: CuttingPickerItem[] = catalog.map((c) => ({
      key: `catalog:${c.id}`,
      displayLabel: `${c.article} — ${c.name}`,
      source: 'catalog',
      cutLengthCm: c.cuttingSpec?.defaultCutLengthCm ?? '',
      cutWidthCm: c.cuttingSpec?.defaultCutWidthCm ?? '',
      cutShapePolygon: c.cuttingSpec?.defaultCutShapePolygon ?? null,
      glbUrl: resolveGlbUrl(c.files),
      photoUrl: c.photoUrl,
    }));
    const fromStock: CuttingPickerItem[] = stockItems.map((s) => ({
      key: `order:${s.itemId}`,
      displayLabel: `${s.article} — ${s.productName}`,
      source: 'order',
      cutLengthCm: s.cuttingSpec?.defaultCutLengthCm ?? '',
      cutWidthCm: s.cuttingSpec?.defaultCutWidthCm ?? '',
      cutShapePolygon: s.cuttingSpec?.defaultCutShapePolygon ?? null,
      glbUrl: resolveGlbUrl(s.files),
      photoUrl: s.photoUrl,
    }));
    return [...fromCatalog, ...fromStock];
  }, [catalog, stockItems]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t('navCutting')}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('cuttingMaterialTitle')}</CardTitle>
          <CardDescription>{t('cuttingMaterialDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>{t('cuttingMaterialLabelLabel')}</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('cuttingMaterialLabelPlaceholder')} />
          </div>
          <div className="space-y-1.5">
            <Label>{tCutting('kindLabel')}</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as 'SHEET' | 'BAR')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SHEET">{tCutting('kindSheet')}</SelectItem>
                <SelectItem value="BAR">{tCutting('kindBar')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{kind === 'SHEET' ? tCutting('stockLengthLabelSheet') : tCutting('stockLengthLabelBar')}</Label>
            <Input type="number" step="any" min={0} value={stockLengthCm} onChange={(e) => setStockLengthCm(e.target.value)} />
          </div>
          {kind === 'SHEET' && (
            <div className="space-y-1.5">
              <Label>{tCutting('stockWidthLabel')}</Label>
              <Input type="number" step="any" min={0} value={stockWidthCm} onChange={(e) => setStockWidthCm(e.target.value)} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>{tCutting('kerfLabel')}</Label>
            <Input type="number" step="any" min={0} value={kerfMm} onChange={(e) => setKerfMm(e.target.value)} />
          </div>
          {kind === 'SHEET' && (
            <div className="flex items-center gap-2 pt-6">
              <Switch checked={allowRotation} onCheckedChange={setAllowRotation} />
              <Label>{tCutting('allowRotationLabel')}</Label>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('cuttingLinesTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {lines.map((row) => (
            <CuttingLineRow
              key={row.key}
              row={row}
              isSheet={kind === 'SHEET'}
              pickerItems={pickerItems}
              onChange={(patch) => updateLine(row.key, patch)}
              onRemove={() => removeLine(row.key)}
              removable={lines.length > 1}
            />
          ))}

          <Button type="button" variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, newLine()])}>
            <Plus className="mr-2 h-4 w-4" />
            {t('cuttingAddLine')}
          </Button>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="button" loading={submitting} onClick={handleSubmit}>
        {t('cuttingCalculateButton')}
      </Button>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('cuttingResultTitle')}</CardTitle>
            <CardDescription>
              {result.kind === 'SHEET' ? t('cuttingUnitsUsedSheet', { count: result.unitsUsed }) : t('cuttingUnitsUsedBar', { count: result.unitsUsed })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {result.stockItems.map((stockItem, i) => (
              <div key={i} className="space-y-1.5">
                <Badge variant="outline">
                  {result.kind === 'SHEET' ? t('cuttingSheetNumber', { number: i + 1 }) : t('cuttingBarNumber', { number: i + 1 })}
                </Badge>
                {result.kind === 'SHEET' ? <SheetStockDiagram stockItem={stockItem} /> : <BarStockDiagram stockItem={stockItem} />}
                {stockItem.usedAreaCm2 != null && (
                  <p className="text-xs text-muted-foreground">
                    {tCutting('usedWasteAreaLabel', { used: toNumber(stockItem.usedAreaCm2) ?? 0, waste: toNumber(stockItem.wasteAreaCm2) ?? 0 })}
                  </p>
                )}
                {stockItem.dxf && (
                  <Button type="button" variant="outline" size="sm" onClick={() => downloadDxf(stockItem.dxf!, i)}>
                    {tCutting('exportDxfButton')}
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
