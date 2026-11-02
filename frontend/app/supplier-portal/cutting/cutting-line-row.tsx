'use client';

import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ShapePolygonPreview } from '@/components/domain/cutting/shape-polygon-preview';

export interface CuttingLineRowState {
  key: string;
  label: string;
  qty: string;
  cutLengthCm: string;
  cutWidthCm: string;
  cutShapePolygon: { outerCm: [number, number][]; holesCm: [number, number][][] } | null;
}

export interface CuttingLineRowProps {
  row: CuttingLineRowState;
  isSheet: boolean;
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
 * `qty`/`cutShapePolygon` already come from wherever the line was added
 * (catalog pick / order pick / manual) — this row only edits them further.
 */
export function CuttingLineRow({ row, isSheet, onChange, onRemove, removable }: CuttingLineRowProps) {
  const t = useTranslations('supplierPortal');
  const tCutting = useTranslations('cutting');

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-md border border-border p-3">
      <div className="min-w-[160px] flex-1 space-y-1.5">
        <Label>{tCutting('adHocPositionLabel')}</Label>
        <Input value={row.label} onChange={(e) => onChange({ label: e.target.value })} placeholder={tCutting('adHocPositionPlaceholder')} />
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
