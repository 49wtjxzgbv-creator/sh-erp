'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useProducts, useProduct } from '@/lib/hooks/use-catalog';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { Input } from '@/components/ui/input';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

/**
 * Lightweight typeahead product picker — no dedicated combobox primitive is
 * in the Radix set this project uses (select/dialog/dropdown-menu/label/
 * tabs/toast/slot only), and pulling one in for a single field isn't worth
 * a new dependency, so this is hand-rolled: an Input + an absolutely
 * positioned result list, backed by `useProducts({ search })` (real
 * server-side search, not a client-side filter over a fixed page). Meant to
 * be reused everywhere a product needs picking — Inventory now, BOM/
 * Production/Procurement/Sales next.
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
  const containerRef = useRef<HTMLDivElement>(null);

  const { data } = useProducts({ search: query, limit: 20 });
  const productIds = useMemo(() => (data?.items ?? []).map((p) => p.id), [data]);
  const { data: photosByProduct } = useFilesForEntities('Product', productIds);

  // A row hydrated from the server only ever has a bare `value` (id) — this
  // resolves and fills in the visible text once, the first time that
  // happens, without fighting a user's own subsequent typing/selection (a
  // real bug: rows loaded into an existing BOM/order previously showed a
  // permanently empty search box even though a real component was saved).
  const { data: selectedProduct } = useProduct(value);
  const { data: photosBySelected } = useFilesForEntities('Product', value ? [value] : []);
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
    <div ref={containerRef} className="relative flex items-center gap-2">
      {value && <Avatar src={photosBySelected?.[value]?.[0]?.downloadUrl} size="sm" className="shrink-0" />}
      <Input
        placeholder={placeholder ?? t('searchPlaceholder')}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (!e.target.value) onChange(undefined, undefined);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 100)}
      />
      {open && query && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-64 overflow-auto rounded-md border border-border bg-popover shadow-md">
          {data?.items.length ? (
            data.items.map((product) => (
              <button
                type="button"
                key={product.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setQuery(`${product.article} — ${product.name}`);
                  hydratedRef.current = true;
                  setOpen(false);
                  onChange(product.id, `${product.article} — ${product.name}`);
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-secondary',
                  product.id === value && 'bg-secondary',
                )}
              >
                <Avatar src={photosByProduct?.[product.id]?.[0]?.downloadUrl} size="sm" />
                <span className="flex min-w-0 flex-col items-start">
                  <span className="truncate font-medium">{product.article}</span>
                  <span className="truncate text-xs text-muted-foreground">{product.name}</span>
                </span>
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
