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
import type { SupplierCatalogEntry } from '@/lib/api-client/supplier-catalog';
import { previewSupplierCutting, type SupplierCuttingResult } from '@/lib/api-client/supplier-cutting';
import { CuttingLineRow, type CuttingLineRowState } from './cutting-line-row';

interface StockPickerRow {
  itemId: string;
  article: string;
  productName: string;
  cuttingSpec: SupplierCatalogEntry['cuttingSpec'];
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
  const [catalogPickerKey, setCatalogPickerKey] = useState(0);
  const [stockPickerKey, setStockPickerKey] = useState(0);

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

  function addFromCuttingSpec(label: string, spec: SupplierCatalogEntry['cuttingSpec']) {
    setLines((prev) => [
      ...prev,
      newLine({
        label,
        cutLengthCm: spec?.defaultCutLengthCm ?? '',
        cutWidthCm: spec?.defaultCutWidthCm ?? '',
        cutShapePolygon: spec?.defaultCutShapePolygon ?? null,
      }),
    ]);
  }

  async function handleSubmit() {
    setError(null);
    setResult(null);
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

  const catalogWithSpec = useMemo(() => catalog.filter((c) => c.cuttingSpec), [catalog]);
  const stockWithSpec = useMemo(() => stockItems.filter((s) => s.cuttingSpec), [stockItems]);

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
              onChange={(patch) => updateLine(row.key, patch)}
              onRemove={() => removeLine(row.key)}
              removable={lines.length > 1}
            />
          ))}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, newLine()])}>
              <Plus className="mr-2 h-4 w-4" />
              {t('cuttingAddManualLine')}
            </Button>

            {catalogWithSpec.length > 0 && (
              <Select
                key={`catalog-${catalogPickerKey}`}
                onValueChange={(productSupplierId) => {
                  const entry = catalog.find((c) => c.id === productSupplierId);
                  if (entry) addFromCuttingSpec(`${entry.article} — ${entry.name}`, entry.cuttingSpec);
                  setCatalogPickerKey((k) => k + 1);
                }}
              >
                <SelectTrigger className="w-56">
                  <SelectValue placeholder={t('cuttingAddFromCatalog')} />
                </SelectTrigger>
                <SelectContent>
                  {catalogWithSpec.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.article} — {entry.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {stockWithSpec.length > 0 && (
              <Select
                key={`stock-${stockPickerKey}`}
                onValueChange={(itemId) => {
                  const item = stockItems.find((s) => s.itemId === itemId);
                  if (item) addFromCuttingSpec(`${item.article} — ${item.productName}`, item.cuttingSpec);
                  setStockPickerKey((k) => k + 1);
                }}
              >
                <SelectTrigger className="w-56">
                  <SelectValue placeholder={t('cuttingAddFromOrders')} />
                </SelectTrigger>
                <SelectContent>
                  {stockWithSpec.map((item) => (
                    <SelectItem key={item.itemId} value={item.itemId}>
                      {item.article} — {item.productName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
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
