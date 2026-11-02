'use client';

import { useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2, Search, Loader2 } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ShapePolygonPreview } from '@/components/domain/cutting/shape-polygon-preview';
import { EntityCombobox } from '@/components/domain/shared/entity-combobox';

export interface CuttingLineRowState {
  key: string;
  label: string;
  qty: string;
  cutLengthCm: string;
  cutWidthCm: string;
  cutShapePolygon: { outerCm: [number, number][]; holesCm: [number, number][][] } | null;
}

/** One name the search-as-you-type field can resolve to — "каталог"/"замовлення" source, carrying the picked item's own cut dimensions/shape for the row to adopt on select. */
export interface CuttingPickerItem {
  key: string;
  displayLabel: string;
  source: 'catalog' | 'order';
  cutLengthCm: string;
  cutWidthCm: string;
  cutShapePolygon: { outerCm: [number, number][]; holesCm: [number, number][][] } | null;
  /** "воно ж розміри має витягувати для розкрою з файлів глб" (2026-11-03) — when there's no saved cuttingSpec dimension, fall back to measuring the product's own 3D model's bounding box instead of leaving the row blank. */
  glbUrl: string | null;
  /** "додай в пошук там де розкрій перед артикулом фото" (2026-11-03) — shown before the article/name in the dropdown, same as every other product list in this portal. */
  photoUrl: string | null;
}

export interface CuttingLineRowProps {
  row: CuttingLineRowState;
  isSheet: boolean;
  pickerItems: CuttingPickerItem[];
  onChange: (patch: Partial<CuttingLineRowState>) => void;
  onRemove: () => void;
  removable: boolean;
}

/**
 * One position in the supplier's own worksheet — "розкрій має могти
 * робити постачальник сам собі" (2026-11-02). A lightweight sibling of the
 * staff `AdHocCutRow` (`app/(app)/cutting/new/ad-hoc-cut-row.tsx`), not a
 * reuse of it — that component is wired to staff-only hooks
 * (`useCuttableProducts`/`useExtractShape`) this portal has no access to.
 *
 * "деталі розкрою назва має бути випадаюче меню і пошук коли починаємо
 * вводити перші символи" (2026-11-02) — the name field IS the search:
 * `EntityCombobox` (the same shared typeahead shell behind every other
 * picker in this app, e.g. `MaterialPicker`) filters `pickerItems` by
 * `row.label` live as the supplier types. Picking a match adopts that
 * item's own cut dimensions/shape; typing something with no match just
 * stays as free text — a manual position, same as before, just without a
 * separate "manual" mode to switch into first.
 */
export function CuttingLineRow({ row, isSheet, pickerItems, onChange, onRemove, removable }: CuttingLineRowProps) {
  const t = useTranslations('supplierPortal');
  const tCutting = useTranslations('cutting');
  const [open, setOpen] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [measureError, setMeasureError] = useState<string | null>(null);
  // Guards against a stale GLB measurement landing after the supplier has already
  // picked a DIFFERENT item (or removed this row) while the fetch+parse was in flight.
  const selectionToken = useRef(0);

  const filteredItems = useMemo(() => {
    const query = row.label.trim().toLowerCase();
    if (!query) return pickerItems;
    return pickerItems.filter((item) => item.displayLabel.toLowerCase().includes(query));
  }, [row.label, pickerItems]);

  async function handleSelect(item: CuttingPickerItem) {
    setOpen(false);
    setMeasureError(null);
    const token = ++selectionToken.current;

    if (item.cutLengthCm && (!isSheet || item.cutWidthCm)) {
      onChange({ label: item.displayLabel, cutLengthCm: item.cutLengthCm, cutWidthCm: item.cutWidthCm, cutShapePolygon: item.cutShapePolygon });
      return;
    }

    onChange({ label: item.displayLabel, cutShapePolygon: item.cutShapePolygon });
    if (!item.glbUrl) return;

    setMeasuring(true);
    try {
      const { computeGlbDimensions } = await import('@/components/domain/files/step-3d-viewer');
      const dims = await computeGlbDimensions(item.glbUrl);
      if (selectionToken.current !== token) return; // a different selection landed first
      if (dims) onChange({ cutLengthCm: String(dims.lengthCm.toFixed(1)), cutWidthCm: String(dims.widthCm.toFixed(1)) });
      else setMeasureError(t('cuttingGlbMeasureEmpty'));
    } catch {
      if (selectionToken.current === token) setMeasureError(t('cuttingGlbMeasureFailed'));
    } finally {
      if (selectionToken.current === token) setMeasuring(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-md border border-border p-3">
      <div className="min-w-[220px] flex-1 space-y-1.5">
        <Label>{tCutting('adHocPositionLabel')}</Label>
        <EntityCombobox<CuttingPickerItem>
          query={row.label}
          onQueryChange={(next) => onChange({ label: next })}
          open={open}
          onOpenChange={setOpen}
          items={filteredItems}
          getKey={(item) => item.key}
          leading={<Search className="h-4 w-4 shrink-0 text-muted-foreground" />}
          onSelect={handleSelect}
          placeholder={t('cuttingLineNamePlaceholder')}
          emptyLabel={t('cuttingLineNoMatches')}
          renderItem={(item) => (
            <span className="flex items-center gap-2">
              <Avatar src={item.photoUrl} size="sm" className="shrink-0" zoomable={false} />
              <span className="truncate">{item.displayLabel}</span>
              <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">
                {item.source === 'catalog' ? t('cuttingSourceCatalog') : t('cuttingSourceOrder')}
              </Badge>
            </span>
          )}
        />
      </div>
      <div className="w-24 space-y-1.5">
        <Label>{tCutting('calculateCuttingQtyLabel')}</Label>
        <Input type="number" step="any" min={0} value={row.qty} onChange={(e) => onChange({ qty: e.target.value })} />
      </div>
      <div className="w-28 space-y-1.5">
        <Label>{tCutting('cutLengthLabel')}</Label>
        <Input type="number" step="any" min={0} value={row.cutLengthCm} onChange={(e) => onChange({ cutLengthCm: e.target.value })} disabled={measuring} />
      </div>
      {isSheet && (
        <div className="w-28 space-y-1.5">
          <Label>{tCutting('cutWidthLabel')}</Label>
          <Input type="number" step="any" min={0} value={row.cutWidthCm} onChange={(e) => onChange({ cutWidthCm: e.target.value })} disabled={measuring} />
        </div>
      )}
      {measuring && (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('cuttingGlbMeasuring')}
        </span>
      )}
      {measureError && <p className="text-xs text-destructive">{measureError}</p>}
      {row.cutShapePolygon && (
        <div className="flex items-center gap-2">
          <ShapePolygonPreview outerCm={row.cutShapePolygon.outerCm} holesCm={row.cutShapePolygon.holesCm} className="h-10 w-10 rounded border border-border bg-muted" />
          <Badge variant="secondary">{t('cuttingShapeFromSpecBadge')}</Badge>
        </div>
      )}
      {removable && (
        <Button type="button" variant="ghost" size="icon" className="ml-auto" onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
