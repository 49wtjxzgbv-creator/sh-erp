'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useCuttableProducts } from '@/lib/hooks/use-cutting';
import type { CuttableProduct } from '@/lib/api-client/cutting';
import { Badge } from '@/components/ui/badge';
import { EntityCombobox } from '@/components/domain/shared/entity-combobox';

export interface MaterialPickerProps {
  value: string | undefined;
  onChange: (material: CuttableProduct | undefined) => void;
  placeholder?: string;
}

/** Typeahead material picker for the ad-hoc worksheet — same server-side-search combobox shell as ProductPicker, scoped to products with a ProductCuttingSpec (useCuttableProducts), so you get the material's kind back on select instead of a capped client-side list. */
export function MaterialPicker({ value, onChange, placeholder }: MaterialPickerProps) {
  const t = useTranslations('cutting');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const { data } = useCuttableProducts({ search: query, limit: 20 });
  const items = data?.items ?? [];

  return (
    <EntityCombobox<CuttableProduct>
      query={query}
      onQueryChange={(next) => {
        setQuery(next);
        if (!next) onChange(undefined);
      }}
      open={open}
      onOpenChange={setOpen}
      items={items}
      getKey={(m) => m.productId}
      isSelected={(m) => m.productId === value}
      onSelect={(m) => {
        setQuery(`${m.product.article} — ${m.product.name}`);
        setOpen(false);
        onChange(m);
      }}
      placeholder={placeholder ?? t('adHocMaterialPlaceholder')}
      renderItem={(m) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex min-w-0 flex-col items-start">
            <span className="truncate font-medium">{m.product.article}</span>
            <span className="truncate text-xs text-muted-foreground">{m.product.name}</span>
          </span>
          <Badge variant="outline" className="ml-auto shrink-0">
            {m.spec.kind === 'SHEET' ? t('kindSheet') : t('kindBar')}
          </Badge>
        </span>
      )}
    />
  );
}
