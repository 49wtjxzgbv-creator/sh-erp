'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useStockShortageBreakdown } from '@/lib/hooks/use-inventory';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

/**
 * Click-through for the RED "Не вистачає для резервації" number: which
 * orders are still short on this (product, warehouse) and by how much —
 * the shortage-side counterpart to ReservationBreakdownPopover's
 * "Зарезервовано" drill-down (same lazy-fetch-on-open pattern, same
 * popover shell), just backed by a different endpoint since a shortage
 * line has no `source` (it's not tied to STOCK vs PURCHASE, just "how much
 * of this order's need is still uncovered").
 */
export function ShortageBreakdownPopover({
  productId,
  warehouseId,
  qty,
  children,
}: {
  productId: string;
  warehouseId: string;
  qty: number;
  children: React.ReactNode;
}) {
  const t = useTranslations('inventory');
  const [open, setOpen] = useState(false);
  const { data: rows } = useStockShortageBreakdown(productId, warehouseId, open);

  if (qty <= 0) return <>{children}</>;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="underline decoration-dotted underline-offset-2 hover:text-foreground">
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64">
        <p className="mb-2 text-xs font-medium text-muted-foreground">{t('shortageByBreakdown')}</p>
        {!rows ? (
          <p className="text-xs text-muted-foreground">{t('loadingShort')}</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">—</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {rows.map((r) => (
              <li key={r.customerOrderId} className="flex justify-between gap-2">
                <span className="truncate">{r.orderNumber ? `№${r.orderNumber}` : r.clientName}</span>
                <span className="tabular-nums">{r.outstandingQty}</span>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
