'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { useExtractShape } from '@/lib/hooks/use-cutting';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { uploadFile } from '@/lib/api-client/files';
import type { MatchedBomLine } from '@/lib/api-client/ai';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { MaterialPicker } from './material-picker';

export interface AdHocRowState {
  key: string;
  /** "довільний розкрій" means the material is as free-form as the piece — either an existing catalog product (reuses its remnants) or a typed-in custom material (no catalog, no remnants). */
  materialMode: 'existing' | 'custom';
  materialProductId: string;
  materialKind: 'BAR' | 'SHEET' | null;
  customLabel: string;
  customKind: 'BAR' | 'SHEET';
  customStockLengthCm: string;
  customStockWidthCm: string;
  customKerfMm: string;
  label: string;
  cutLengthCm: string;
  cutWidthCm: string;
  shapePolygon: { outerCm: [number, number][]; holesCm: [number, number][][] } | null;
  qty: string;
}

export interface AdHocCutRowProps {
  row: AdHocRowState;
  onChange: (patch: Partial<AdHocRowState>) => void;
  onRemove: () => void;
  removable: boolean;
}

/** One position in the ad-hoc multi-material worksheet — own material/shape/qty, own STEP-upload state (why this is a separate component: useExtractShape must be called once per row, not inside the parent's .map()). */
export function AdHocCutRow({ row, onChange, onRemove, removable }: AdHocCutRowProps) {
  const t = useTranslations('cutting');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const extractShape = useExtractShape();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [shapeCandidates, setShapeCandidates] = useState<MatchedBomLine[] | null>(null);
  const [shapeError, setShapeError] = useState<string | null>(null);

  const isSheet = row.materialMode === 'existing' ? row.materialKind === 'SHEET' : row.customKind === 'SHEET';

  function adoptShapeLine(line: MatchedBomLine) {
    onChange({
      cutLengthCm: line.lengthCm != null ? String(line.lengthCm) : row.cutLengthCm,
      cutWidthCm: line.widthCm != null ? String(line.widthCm) : row.cutWidthCm,
      shapePolygon: line.shapePolygon ?? null,
      label: row.label || line.rawName,
    });
    setShapeCandidates(null);
  }

  async function handleUploadStep(file: File) {
    setShapeError(null);
    setShapeCandidates(null);
    try {
      // No real entity this position belongs to (that's the point of an
      // ad-hoc line) — FileAsset.entityId is a UUID column with no FK, so a
      // fresh random id is a harmless, valid tag for this one-off upload.
      const fileAsset = await uploadFile(file, { domain: 'PRODUCT_DOCUMENT', entityType: 'Product', entityId: crypto.randomUUID() });
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

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex gap-1.5" data-tour="adhoc-material-mode-toggle">
        <Button type="button" size="sm" variant={row.materialMode === 'existing' ? 'default' : 'outline'} onClick={() => onChange({ materialMode: 'existing' })}>
          {t('adHocModeExisting')}
        </Button>
        <Button type="button" size="sm" variant={row.materialMode === 'custom' ? 'default' : 'outline'} onClick={() => onChange({ materialMode: 'custom' })}>
          {t('adHocModeCustom')}
        </Button>
      </div>

      {row.materialMode === 'existing' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t('adHocMaterialLabel')}</Label>
            <MaterialPicker
              value={row.materialProductId || undefined}
              onChange={(material) =>
                onChange({ materialProductId: material?.productId ?? '', materialKind: material?.spec.kind ?? null })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('adHocPositionLabel')}</Label>
            <Input value={row.label} onChange={(e) => onChange({ label: e.target.value })} placeholder={t('adHocPositionPlaceholder')} />
          </div>
        </div>
      ) : (
        <div className="space-y-3 rounded-md bg-muted/50 p-2.5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t('adHocCustomNameLabel')}</Label>
              <Input value={row.customLabel} onChange={(e) => onChange({ customLabel: e.target.value })} placeholder={t('adHocCustomNamePlaceholder')} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('kindLabel')}</Label>
              <Select value={row.customKind} onValueChange={(v) => onChange({ customKind: v as 'BAR' | 'SHEET' })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BAR">{t('kindBar')}</SelectItem>
                  <SelectItem value="SHEET">{t('kindSheet')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>{row.customKind === 'BAR' ? t('stockLengthLabelBar') : t('stockLengthLabelSheet')}</Label>
              <Input type="number" step="any" min={0} value={row.customStockLengthCm} onChange={(e) => onChange({ customStockLengthCm: e.target.value })} />
            </div>
            {row.customKind === 'SHEET' && (
              <div className="space-y-1.5">
                <Label>{t('stockWidthLabel')}</Label>
                <Input type="number" step="any" min={0} value={row.customStockWidthCm} onChange={(e) => onChange({ customStockWidthCm: e.target.value })} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>{t('kerfLabel')}</Label>
              <Input type="number" step="any" min={0} value={row.customKerfMm} onChange={(e) => onChange({ customKerfMm: e.target.value })} placeholder="3" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t('adHocPositionLabel')}</Label>
            <Input value={row.label} onChange={(e) => onChange({ label: e.target.value })} placeholder={t('adHocPositionPlaceholder')} />
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>{t('cutLengthLabel')}</Label>
          <Input type="number" step="any" min={0} value={row.cutLengthCm} onChange={(e) => onChange({ cutLengthCm: e.target.value })} />
        </div>
        {isSheet && (
          <div className="space-y-1.5">
            <Label>{t('cutWidthLabel')}</Label>
            <Input type="number" step="any" min={0} value={row.cutWidthCm} onChange={(e) => onChange({ cutWidthCm: e.target.value })} />
          </div>
        )}
        <div className="space-y-1.5">
          <Label>{t('calculateCuttingQtyLabel')}</Label>
          <Input type="number" step="any" min={0} value={row.qty} onChange={(e) => onChange({ qty: e.target.value })} />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".step,.stp,.dxf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleUploadStep(file);
          }}
        />
        <Button type="button" variant="outline" size="sm" loading={extractShape.isPending} onClick={() => fileInputRef.current?.click()}>
          {t('uploadStepLabel')}
        </Button>
        {row.shapePolygon && <Badge variant="secondary">{t('shapeFromStepBadge')}</Badge>}
        {removable && (
          <Button type="button" variant="ghost" size="icon" className="ml-auto" onClick={onRemove}>
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
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
  );
}
