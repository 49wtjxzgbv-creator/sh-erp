'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { useRemnants } from '@/lib/hooks/use-cutting';
import { useWarehouses } from '@/lib/hooks/use-inventory';
import { useProductsByIds } from '@/lib/hooks/use-catalog';
import { toNumber } from '@/lib/api-client/decimal';
import type { StockRemnant } from '@/lib/api-client/cutting';
import { DataTable } from '@/components/domain/data-table/data-table';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

/** Розкрій (2026-10-31) — "Залишки розкрою": reusable leftover bar/sheet offcuts, created by CuttingPlansService#execute. Read-only list; remnants are only ever consumed as a side effect of running a future cutting plan. */
export default function RemnantsPage() {
  const t = useTranslations('cutting');
  const tInventory = useTranslations('inventory');
  const { data: warehouses } = useWarehouses();
  const [warehouseId, setWarehouseId] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const { data: remnants, isLoading } = useRemnants({ warehouseId });

  const productIds = useMemo(() => Array.from(new Set((remnants ?? []).map((r) => r.productId))), [remnants]);
  const { data: productsById } = useProductsByIds(productIds);

  const warehouseName = useMemo(() => {
    const map = new Map<string, string>();
    warehouses?.forEach((w) => map.set(w.id, w.name));
    return map;
  }, [warehouses]);

  const filteredRemnants = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return remnants ?? [];
    return (remnants ?? []).filter((r) => {
      const p = productsById?.get(r.productId);
      return Boolean(p && (p.article.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)));
    });
  }, [remnants, productsById, search]);

  const columns = useMemo<ColumnDef<StockRemnant>[]>(
    () => [
      { accessorKey: 'code', header: t('remnantsColumnCode') },
      {
        id: 'product',
        accessorFn: (row) => row.productId,
        header: t('remnantsColumnProduct'),
        cell: ({ getValue }) => {
          const p = productsById?.get(getValue() as string);
          return p ? `${p.name} (${p.article})` : (getValue() as string);
        },
      },
      {
        id: 'size',
        header: t('remnantsColumnSize'),
        cell: ({ row }) => {
          const lengthCm = toNumber(row.original.lengthCm);
          const widthCm = toNumber(row.original.widthCm);
          return widthCm != null ? `${lengthCm}×${widthCm} см` : `${lengthCm} см`;
        },
      },
      {
        accessorKey: 'warehouseId',
        header: t('remnantsColumnWarehouse'),
        cell: ({ getValue }) => warehouseName.get(getValue() as string) ?? (getValue() as string),
      },
      {
        accessorKey: 'createdAt',
        header: t('remnantsColumnCreated'),
        cell: ({ getValue }) => new Date(getValue() as string).toLocaleDateString(),
      },
    ],
    [t, productsById, warehouseName],
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{t('remnantsPageTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('remnantsPageDescription')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder={t('filterByProduct')} value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
        <Select value={warehouseId ?? '__all__'} onValueChange={(v) => setWarehouseId(v === '__all__' ? undefined : v)}>
          <SelectTrigger className="max-w-xs">
            <SelectValue placeholder={t('filterByWarehouse')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{tInventory('allWarehouses')}</SelectItem>
            {warehouses?.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!isLoading && filteredRemnants.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t('remnantsEmpty')}</p>
      ) : (
        <DataTable columns={columns} data={filteredRemnants} isLoading={isLoading} />
      )}
    </div>
  );
}
