'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Avatar } from '@/components/ui/avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingBlock } from '@/components/ui/loading-block';
import { FilePreviewButton } from '@/components/domain/files/file-preview-button';
import { is3DModelFile, isGlbFile } from '@/components/domain/files/entity-documents-field';
import { View3DButton } from '@/components/domain/files/view-3d-button';
import { ArViewButton } from '@/components/domain/files/ar-view-button';
import { ShapePolygonPreview } from '@/components/domain/cutting/shape-polygon-preview';
import { supplierPortalApi } from '@/lib/supplier-portal/api';
import { useApiErrorMessage } from '@/lib/api-error-message';
import type { SupplierCatalogEntry } from '@/lib/api-client/supplier-catalog';
import type { FileAssetWithUrl } from '@/lib/api-client/files';

/** Same AR variant-preference logic as the catalog list page / staff /catalog page — always prefer the de-instanced arOptimizedDownloadUrl. */
function resolveArGlbUrl(files: FileAssetWithUrl[]): string | null {
  const modelDoc = files.find((f) => is3DModelFile(f.originalName));
  if (!modelDoc) return null;
  if (isGlbFile(modelDoc.originalName)) {
    return modelDoc.arOptimizedDownloadUrl || modelDoc.mobileOptimizedDownloadUrl || modelDoc.optimizedDownloadUrl || modelDoc.downloadUrl;
  }
  return modelDoc.convertedDownloadUrl ?? null;
}

/**
 * Supplier-portal product catalog detail (2026-11-02) — one entry
 * (`ProductSupplier` row) auto-populated whenever this product was sent to
 * the supplier via a purchase order/sent purchase request
 * (SupplierCatalogService#ensureCatalogEntries). Read-only everywhere
 * except the two supplier-own price fields at the bottom — photo (with the
 * same View3DButton/ArViewButton quick-look treatment as the catalog list
 * page, "щоб візуально був як у виробника", 2026-11-02), the full file
 * list (previewed in-app via FilePreviewButton), weight (the only physical
 * attribute Product actually has), and the cutting spec when one is
 * configured are all just the company's own product data.
 */
export default function SupplierPortalCatalogDetailPage() {
  const params = useParams<{ id: string }>();
  const t = useTranslations('supplierPortal');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();

  const [entry, setEntry] = useState<SupplierCatalogEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [costPrice, setCostPrice] = useState('');
  const [offeredPrice, setOfferedPrice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await supplierPortalApi.get<SupplierCatalogEntry>(`supplier-portal/catalog/${params.id}`);
      setEntry(res);
      setCostPrice(res.supplierCostPrice != null ? String(res.supplierCostPrice) : '');
      setOfferedPrice(res.supplierOfferedPrice != null ? String(res.supplierOfferedPrice) : '');
    } catch (err) {
      setLoadError(err);
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loadError) {
    return <p className="text-sm text-destructive">{apiErrorMessage(loadError, t('catalogEntryNotFound'))}</p>;
  }

  if (loading || !entry) {
    return <LoadingBlock />;
  }

  async function handleSave() {
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      await supplierPortalApi.patch(`supplier-portal/catalog/${entry!.id}`, {
        supplierCostPrice: costPrice ? Number(costPrice) : undefined,
        supplierOfferedPrice: offeredPrice ? Number(offeredPrice) : undefined,
      });
      setSuccess(true);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    } finally {
      setSubmitting(false);
    }
  }

  const modelDoc = entry.files.find((f) => is3DModelFile(f.originalName));
  const arGlbUrl = resolveArGlbUrl(entry.files);

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-center gap-1">
          <Avatar src={entry.photoUrl} size="lg" />
          {modelDoc && <View3DButton file={modelDoc} className="px-1.5 py-0.5 text-[10px]" />}
          {arGlbUrl && <ArViewButton getGlbUrl={() => Promise.resolve(arGlbUrl)} className="px-1.5 py-0.5 text-[10px]" />}
        </div>
        <div>
          <h2 className="text-lg font-semibold">{entry.name}</h2>
          <p className="text-sm text-muted-foreground">{entry.article}</p>
        </div>
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">{t('weightLabel')}</p>
            <p className="text-sm">{entry.weightPerUnitKg ?? '—'}</p>
          </div>
        </CardContent>
      </Card>

      {entry.files.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('attachFiles')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            {entry.files.map((file) => (
              <FilePreviewButton key={file.id} file={file} />
            ))}
          </CardContent>
        </Card>
      )}

      {entry.cuttingSpec && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('cuttingSpecLabel')}</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-4">
            {entry.cuttingSpec.defaultCutShapePolygon && (
              <ShapePolygonPreview
                outerCm={entry.cuttingSpec.defaultCutShapePolygon.outerCm}
                holesCm={entry.cuttingSpec.defaultCutShapePolygon.holesCm}
                className="h-16 w-16 shrink-0 rounded border border-border bg-muted"
              />
            )}
            <div className="space-y-1 text-sm">
              <p>{entry.cuttingSpec.kind === 'SHEET' ? t('kindSheet') : t('kindBar')}</p>
              <p className="text-muted-foreground">
                {t('stockDimensionsLabel')}: {entry.cuttingSpec.stockLengthCm}
                {entry.cuttingSpec.stockWidthCm ? ` × ${entry.cuttingSpec.stockWidthCm}` : ''} см
              </p>
              {entry.cuttingSpec.defaultCutLengthCm && (
                <p className="text-muted-foreground">
                  {t('cutDimensionsLabel')}: {entry.cuttingSpec.defaultCutLengthCm}
                  {entry.cuttingSpec.defaultCutWidthCm ? ` × ${entry.cuttingSpec.defaultCutWidthCm}` : ''} см
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('yourPricesTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="costPrice">{t('supplierCostPriceLabel')}</Label>
              <Input id="costPrice" type="number" step="any" min={0} value={costPrice} onChange={(e) => setCostPrice(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="offeredPrice">{t('supplierOfferedPriceLabel')}</Label>
              <Input id="offeredPrice" type="number" step="any" min={0} value={offeredPrice} onChange={(e) => setOfferedPrice(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {success && <p className="text-sm text-success">{t('catalogSaveSuccess')}</p>}
          <Button onClick={handleSave} loading={submitting}>
            {tc('save')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
