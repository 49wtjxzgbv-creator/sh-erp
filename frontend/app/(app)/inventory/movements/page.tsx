'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { useStockHistory, useWarehouses } from '@/lib/hooks/use-inventory';
import { useProductsByIds } from '@/lib/hooks/use-catalog';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import type { StockMovement } from '@/lib/api-client/inventory';
import { DataTable } from '@/components/domain/data-table/data-table';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

const PAGE_SIZE = 50;

export default function StockHistoryPage() {
  const t = useTranslations('inventory');
  const tCatalog = useTranslations('catalog');
  const [warehouseId, setWarehouseId] = useState<string | undefined>(undefined);
  const [offset, setOffset] = useState(0);

  const { data: warehouses } = useWarehouses();
  const { data, isLoading } = useStockHistory({ warehouseId, limit: PAGE_SIZE, offset });

  const warehouseName = useMemo(() => {
    const map = new Map<string, string>();
    warehouses?.forEach((w) => map.set(w.id, w.name));
    return map;
  }, [warehouses]);

  // StockMovement is a thin ledger row (no Product join) — same
  // productId-resolution shape as Stock Levels' own list.
  const productIds = useMemo(() => Array.from(new Set((data?.items ?? []).map((m) => m.productId))), [data]);
  const { data: productsById } = useProductsByIds(productIds);
  const { data: photosByProduct } = useFilesForEntities('Product', productIds, 'PRODUCT_PHOTO');

  const columns = useMemo<ColumnDef<StockMovement>[]>(
    () => [
      {
        accessorKey: 'createdAt',
        header: '—',
        cell: ({ getValue }) => new Date(getValue() as string).toLocaleString(),
      },
      { accessorKey: 'type', header: t('movementType'), cell: ({ getValue }) => <Badge variant="outline">{getValue() as string}</Badge> },
      {
        id: 'photo',
        header: tCatalog('photo'),
        cell: ({ row }) => <Avatar src={photosByProduct?.[row.original.productId]?.[0]?.downloadUrl} size="sm" />,
      },
      {
        id: 'article',
        accessorFn: (row) => row.productId,
        header: tCatalog('article'),
        cell: ({ getValue }) => productsById?.get(getValue() as string)?.article ?? '—',
      },
      {
        id: 'name',
        accessorFn: (row) => row.productId,
        header: tCatalog('name'),
        cell: ({ getValue }) => productsById?.get(getValue() as string)?.name ?? (getValue() as string),
      },
      {
        accessorKey: 'warehouseId',
        header: t('warehouse'),
        cell: ({ getValue }) => {
          const id = getValue() as string | null;
          return id ? warehouseName.get(id) ?? id : '—';
        },
      },
      { accessorKey: 'qtyDelta', header: t('qtyDelta') },
      { accessorKey: 'comment', header: t('comment'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
    ],
    [t, tCatalog, warehouseName, productsById, photosByProduct],
  );

  return (
    <div className="space-y-4">
      <Select value={warehouseId ?? '__all__'} onValueChange={(v) => { setWarehouseId(v === '__all__' ? undefined : v); setOffset(0); }}>
        <SelectTrigger className="max-w-xs">
          <SelectValue placeholder={t('filterByWarehouse')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">{t('allWarehouses')}</SelectItem>
          {warehouses?.map((w) => (
            <SelectItem key={w.id} value={w.id}>
              {w.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        pagination={data ? { offset, limit: PAGE_SIZE, total: data.total, onOffsetChange: setOffset } : undefined}
      />
    </div>
  );
}
