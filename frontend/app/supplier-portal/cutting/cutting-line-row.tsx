'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
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

  const filteredItems = useMemo(() => {
    const query = row.label.trim().toLowerCase();
    if (!query) return pickerItems;
    return pickerItems.filter((item) => item.displayLabel.toLowerCase().includes(query));
  }, [row.label, pickerItems]);

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
          onSelect={(item) => {
            onChange({ label: item.displayLabel, cutLengthCm: item.cutLengthCm, cutWidthCm: item.cutWidthCm, cutShapePolygon: item.cutShapePolygon });
            setOpen(false);
          }}
          placeholder={t('cuttingLineNamePlaceholder')}
          emptyLabel={t('cuttingLineNoMatches')}
          renderItem={(item) => (
            <span className="flex items-center gap-2">
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
        <Input type="number" step="any" min={0} value={row.cutLengthCm} onChange={(e) => onChange({ cutLengthCm: e.target.value })} />
      </div>
      {isSheet && (
        <div className="w-28 space-y-1.5">
          <Label>{tCutting('cutWidthLabel')}</Label>
          <Input type="number" step="any" min={0} value={row.cutWidthCm} onChange={(e) => onChange({ cutWidthCm: e.target.value })} />
        </div>
      )}
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
