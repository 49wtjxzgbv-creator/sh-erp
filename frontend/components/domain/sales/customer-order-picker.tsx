'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useCustomerOrders } from '@/lib/hooks/use-sales';
import { EntityCombobox } from '@/components/domain/shared/entity-combobox';

/**
 * Fifth sibling of product-picker.tsx / assembly-picker.tsx / employee-picker.tsx
 * / supplier-picker.tsx — same EntityCombobox-backed typeahead shell
 * (components/domain/shared/entity-combobox.tsx). Used to link a shipment to
 * the customer order it fulfills (`Shipment.customerOrderId`, optional per
 * the real DTO — a shipment doesn't have to trace back to an order).
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

  const { data } = useCustomerOrders({ search: query, limit: 20 });
  const items = data?.items ?? [];

  useEffect(() => {
    if (!value) setQuery('');
  }, [value]);

  return (
    <EntityCombobox
      query={query}
      onQueryChange={(next) => {
        setQuery(next);
        if (!next) onChange(undefined, undefined);
      }}
      open={open}
      onOpenChange={setOpen}
      items={items}
      getKey={(order) => order.id}
      isSelected={(order) => order.id === value}
      onSelect={(order) => {
        const label = order.orderNumber ? `${order.clientName} — № ${order.orderNumber}` : order.clientName;
        setQuery(order.orderNumber ? `${order.orderNumber} — ${order.clientName}` : order.clientName);
        setOpen(false);
        // Includes orderNumber when present (2026-09-16 user request — HR's
        // "Зарплата по замовленню" print/subtitle was missing it, having
        // only ever received clientName here) — same "clientName — №
        // orderNumber" convention sales/[id]/page.tsx already composes by
        // hand for its own widgets' orderLabel prop.
        onChange(order.id, label);
      }}
      placeholder={placeholder ?? t('searchOrders')}
      renderItem={(order) => (
        <span className="flex flex-col items-start">
          <span className="font-medium">{order.clientName}</span>
          {order.orderNumber && <span className="text-xs text-muted-foreground">{order.orderNumber}</span>}
        </span>
      )}
    />
  );
}
