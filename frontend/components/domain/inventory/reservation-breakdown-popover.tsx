'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useStockReservationBreakdown } from '@/lib/hooks/use-inventory';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

/**
 * §17: "Зарезервовано: 65" → click to see №1001 — 20, №1002 — 30, ... — the
 * warehouse levels table's "Зарезервовано" drill-down.
 */
export function ReservationBreakdownPopover({
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
  const { data: rows } = useStockReservationBreakdown(productId, warehouseId, open);

  if (qty <= 0) return <>{children}</>;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="underline decoration-dotted underline-offset-2 hover:text-foreground">
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64">
        <p className="mb-2 text-xs font-medium text-muted-foreground">{t('reservedByBreakdown')}</p>
        {!rows ? (
          <p className="text-xs text-muted-foreground">{t('loadingShort')}</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">—</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {rows.map((b) => (
              <li key={`${b.customerOrderId}-${b.source}`} className="flex justify-between gap-2">
                <span className="truncate">{b.orderNumber ? `№${b.orderNumber}` : b.clientName}</span>
                <span className="tabular-nums">{b.qty}</span>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
