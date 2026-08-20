'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useProducts, useProduct } from '@/lib/hooks/use-catalog';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { Avatar } from '@/components/ui/avatar';
import { EntityCombobox } from '@/components/domain/shared/entity-combobox';

/**
 * Typeahead product picker — backed by `useProducts({ search })` (real
 * server-side search, not a client-side filter over a fixed page). Meant to
 * be reused everywhere a product needs picking. Positioning/keyboard-nav
 * shell lives in EntityCombobox (components/domain/shared/entity-combobox.tsx);
 * this component owns only product-specific data-fetching, hydration, and
 * rendering.
 */
export interface ProductPickerProps {
  value: string | undefined;
  onChange: (productId: string | undefined, label: string | undefined) => void;
  placeholder?: string;
}

export function ProductPicker({ value, onChange, placeholder }: ProductPickerProps) {
  const t = useTranslations('catalog');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const { data } = useProducts({ search: query, limit: 20 });
  const items = data?.items ?? [];
  const productIds = useMemo(() => (data?.items ?? []).map((p) => p.id), [data]);
  const { data: photosByProduct } = useFilesForEntities('Product', productIds, 'PRODUCT_PHOTO');

  // A row hydrated from the server only ever has a bare `value` (id) — this
  // resolves and fills in the visible text once, the first time that
  // happens, without fighting a user's own subsequent typing/selection (a
  // real bug: rows loaded into an existing BOM/order previously showed a
  // permanently empty search box even though a real component was saved).
  const { data: selectedProduct } = useProduct(value);
  const { data: photosBySelected } = useFilesForEntities('Product', value ? [value] : [], 'PRODUCT_PHOTO');
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current || !value || !selectedProduct) return;
    hydratedRef.current = true;
    setQuery(`${selectedProduct.article} — ${selectedProduct.name}`);
  }, [value, selectedProduct]);

  // Reset the visible text if the caller clears `value` externally (e.g. form reset).
  useEffect(() => {
    if (!value) {
      setQuery('');
      hydratedRef.current = false;
    }
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
      getKey={(product) => product.id}
      isSelected={(product) => product.id === value}
      onSelect={(product) => {
        setQuery(`${product.article} — ${product.name}`);
        hydratedRef.current = true;
        setOpen(false);
        onChange(product.id, `${product.article} — ${product.name}`);
      }}
      placeholder={placeholder ?? t('searchPlaceholder')}
      leading={value ? <Avatar src={photosBySelected?.[value]?.[0]?.downloadUrl} size="sm" className="shrink-0" /> : undefined}
      renderItem={(product) => (
        <span className="flex items-center gap-2.5">
          <Avatar src={photosByProduct?.[product.id]?.[0]?.downloadUrl} size="sm" />
          <span className="flex min-w-0 flex-col items-start">
            <span className="truncate font-medium">{product.article}</span>
            <span className="truncate text-xs text-muted-foreground">{product.name}</span>
          </span>
        </span>
      )}
    />
  );
}
