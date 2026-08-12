'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useCustomerOrders } from '@/lib/hooks/use-sales';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Fifth sibling of product-picker.tsx / assembly-picker.tsx / employee-picker.tsx
 * / supplier-picker.tsx — same hand-rolled typeahead shell. Used to link a
 * shipment to the customer order it fulfills (`Shipment.customerOrderId`,
 * optional per the real DTO — a shipment doesn't have to trace back to an
 * order).
 */
export interface CustomerOrderPickerProps {
  value: string | undefined;
  onChange: (orderId: string | undefined, label: string | undefined) => void;
  placeholder?: string;
}

export function CustomerOrderPicker({ value, onChange, placeholder }: CustomerOrderPickerProps) {
  const t = useTranslations('sales');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data } = useCustomerOrders({ search: query, limit: 20 });

  useEffect(() => {
    if (!value) setQuery('');
  }, [value]);

  return (
    <div ref={containerRef} className="relative">
      <Input
        placeholder={placeholder ?? t('searchOrders')}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (!e.target.value) onChange(undefined, undefined);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 100)}
      />
      {open && (
        <div className="absolute z-40 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover shadow-md">
          {data?.items.length ? (
            data.items.map((order) => (
              <button
                type="button"
                key={order.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setQuery(order.orderNumber ? `${order.orderNumber} — ${order.clientName}` : order.clientName);
                  setOpen(false);
                  onChange(order.id, order.clientName);
                }}
                className={cn(
                  'flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-secondary',
                  order.id === value && 'bg-secondary',
                )}
              >
                <span className="font-medium">{order.clientName}</span>
                {order.orderNumber && <span className="text-xs text-muted-foreground">{order.orderNumber}</span>}
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-sm text-muted-foreground">—</div>
          )}
        </div>
      )}
    </div>
  );
}
