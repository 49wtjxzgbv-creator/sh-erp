'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ProductPicker } from '@/components/domain/catalog/product-picker';
import { useWarehouses, useStockShortageBreakdown } from '@/lib/hooks/use-inventory';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export interface ShortagePickResult {
  productId: string;
  articleSnapshot: string;
  productNameSnapshot: string;
  qty: number;
  requirementIds: string[];
}

/**
 * "це має підтягуватись з продажі і заявки постачальникам" (2026-11-03) —
 * reuses the EXISTING cross-order shortage query
 * (StockReservationService#getShortageBreakdown, already powering the
 * warehouse page's "Не вистачає для резервації" drill-down) as the data
 * source for building a заявка line: pick a product, see which of the
 * company's own open CustomerOrders are still short on it and by when,
 * deselect any that shouldn't be included this time, and the remaining
 * quantity sums automatically — replacing the free-text "Скло-350.
 * Вікно-650." comment staff used to type by hand with a real, traceable
 * link (`requirementIds`, stamped onto `fulfillingPurchaseRequestItemId`
 * server-side).
 */
type QtyBasis = 'outstanding' | 'required';

export function ShortagePickerDialog({ onPick }: { onPick: (result: ShortagePickResult) => void }) {
  const t = useTranslations('procurement');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState<string | undefined>(undefined);
  const [productLabel, setProductLabel] = useState('');
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  // "а якщо я не хочу з дефіциту, а хочу замовити повну кількість яка
  // потрібна" (2026-11-03) — `outstandingQty` (requiredQty minus what's
  // already covered by stock/reservations) is the default, matching the
  // "Не вистачає для резервації" number this dialog reuses as its data
  // source, but staff may want the order's FULL need regardless of
  // existing coverage (e.g. a buffer, or they don't trust what's
  // currently reserved) — this toggle switches which field rows
  // display/sum, with no change to which requirements get claimed.
  const [qtyBasis, setQtyBasis] = useState<QtyBasis>('outstanding');

  const { data: warehouses } = useWarehouses();
  const defaultWarehouseId = warehouses?.find((w) => w.isDefault)?.id ?? warehouses?.[0]?.id;
  const { data: rows } = useStockShortageBreakdown(productId, defaultWarehouseId, open && Boolean(productId));

  function reset() {
    setProductId(undefined);
    setProductLabel('');
    setExcludedIds(new Set());
    setQtyBasis('outstanding');
  }

  function toggle(requirementId: string) {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(requirementId)) next.delete(requirementId);
      else next.add(requirementId);
      return next;
    });
  }

  function qtyFor(row: { outstandingQty: number; requiredQty: number }): number {
    return qtyBasis === 'required' ? row.requiredQty : row.outstandingQty;
  }

  const selectedRows = (rows ?? []).filter((r) => !excludedIds.has(r.requirementId));
  const totalQty = selectedRows.reduce((sum, r) => sum + qtyFor(r), 0);

  function handleAdd() {
    if (!productId || selectedRows.length === 0) return;
    const [article, name] = productLabel.split(' — ');
    onPick({
      productId,
      articleSnapshot: article?.trim() || productLabel,
      productNameSnapshot: name?.trim() || productLabel,
      qty: totalQty,
      requirementIds: selectedRows.map((r) => r.requirementId),
    });
    setOpen(false);
    reset();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          {t('addFromShortage')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('addFromShortageTitle')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <ProductPicker
            value={productId}
            onChange={(id, label) => {
              setProductId(id);
              setProductLabel(label ?? '');
              setExcludedIds(new Set());
            }}
          />
          {productId && rows && rows.length > 0 && (
            <div className="flex gap-1 rounded-md border border-border p-0.5 text-sm">
              <button
                type="button"
                className={`flex-1 rounded px-2 py-1 ${qtyBasis === 'outstanding' ? 'bg-secondary font-medium' : 'text-muted-foreground'}`}
                onClick={() => setQtyBasis('outstanding')}
              >
                {t('addFromShortageBasisOutstanding')}
              </button>
              <button
                type="button"
                className={`flex-1 rounded px-2 py-1 ${qtyBasis === 'required' ? 'bg-secondary font-medium' : 'text-muted-foreground'}`}
                onClick={() => setQtyBasis('required')}
              >
                {t('addFromShortageBasisRequired')}
              </button>
            </div>
          )}
          {productId &&
            (!rows ? (
              <p className="text-sm text-muted-foreground">{tc('loading')}</p>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('addFromShortageEmpty')}</p>
            ) : (
              <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-2 text-sm">
                {rows.map((r) => (
                  <li key={r.requirementId} className="flex items-center justify-between gap-2 py-1">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={!excludedIds.has(r.requirementId)} onChange={() => toggle(r.requirementId)} />
                      <span>{r.orderNumber ? `№${r.orderNumber}` : r.clientName}</span>
                      {r.deadline && <span className="text-xs text-muted-foreground">{new Date(r.deadline).toLocaleDateString()}</span>}
                    </label>
                    <span className="tabular-nums">{qtyFor(r)}</span>
                  </li>
                ))}
              </ul>
            ))}
          {productId && rows && rows.length > 0 && <p className="text-sm font-medium">{t('addFromShortageTotal', { qty: totalQty })}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {tc('cancel')}
          </Button>
          <Button type="button" onClick={handleAdd} disabled={!productId || selectedRows.length === 0}>
            {t('addFromShortageConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
