'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { ArrowLeftRight, Plus } from 'lucide-react';
import { useStockLevels, useWarehouses } from '@/lib/hooks/use-inventory';
import { useProductsByIds } from '@/lib/hooks/use-catalog';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { updateProduct } from '@/lib/api-client/catalog';
import { useApiErrorMessage } from '@/lib/api-error-message';
import type { WarehouseStock } from '@/lib/api-client/inventory';
import { DataTable } from '@/components/domain/data-table/data-table';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { RecordMovementDialog } from '@/components/domain/inventory/record-movement-dialog';
import { MoveStockDialog } from '@/components/domain/inventory/move-stock-dialog';
import { cn } from '@/lib/utils';

export default function StockLevelsPage() {
  const t = useTranslations('inventory');
  const tCatalog = useTranslations('catalog');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const qc = useQueryClient();
  const [warehouseId, setWarehouseId] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [movementOpen, setMovementOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [savingCell, setSavingCell] = useState<string | null>(null);
  const [cellError, setCellError] = useState<string | null>(null);

  const { data: warehouses } = useWarehouses();
  const { data: levels, isLoading } = useStockLevels({ warehouseId });

  const warehouseName = useMemo(() => {
    const map = new Map<string, string>();
    warehouses?.forEach((w) => map.set(w.id, w.name));
    return map;
  }, [warehouses]);

  // GET /stock/levels is a thin pass-through over WarehouseStock (no
  // Product join), so productId is resolved into a name/article/photo
  // client-side via one batch call each — GET /products/batch and
  // GET /files/batch, same N-request-avoidance shape already used by
  // Catalog/BOM's list views (see products.controller.ts's own comment).
  const productIds = useMemo(() => Array.from(new Set((levels ?? []).map((l) => l.productId))), [levels]);
  const { data: productsById } = useProductsByIds(productIds);
  const { data: photosByProduct } = useFilesForEntities('Product', productIds, 'PRODUCT_PHOTO');

  // Client-side, same reason `levels` is resolved against Product client-side
  // above: GET /stock/levels has no Product join to filter by name/article
  // server-side against.
  const filteredLevels = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return levels ?? [];
    return (levels ?? []).filter((l) => {
      const p = productsById?.get(l.productId);
      return Boolean(p && (p.article.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)));
    });
  }, [levels, productsById, search]);

  // `cell` ("Комірка" — bin/shelf location) lives on `Product`, not per
  // warehouse (schema.prisma), so editing it here is a plain
  // `PATCH /products/:id` — the same field the Catalog grid already edits.
  // Invalidating the `products` query family (not just this page's own
  // `products/batch` cache) is what makes the edit show up everywhere else
  // that reads it (Catalog grid, product detail page), not just here.
  async function saveCell(productId: string, value: string) {
    setCellError(null);
    setSavingCell(productId);
    try {
      await updateProduct(productId, { cell: value });
      qc.invalidateQueries({ queryKey: ['products'] });
    } catch (err) {
      setCellError(apiErrorMessage(err, tc('error')));
    } finally {
      setSavingCell(null);
    }
  }

  const columns = useMemo<ColumnDef<WarehouseStock>[]>(
    () => [
      {
        id: 'photo',
        header: tCatalog('photo'),
        cell: ({ row }) => <Avatar src={photosByProduct?.[row.original.productId]?.[0]?.downloadUrl} size="lg" />,
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
        id: 'cell',
        header: tCatalog('cell'),
        cell: ({ row }) => {
          const product = productsById?.get(row.original.productId);
          return (
            <Input
              defaultValue={product?.cell ?? ''}
              disabled={!product}
              className={cn('h-8 w-28', savingCell === row.original.productId && 'opacity-50')}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                if (!product || e.target.value === (product.cell ?? '')) return;
                saveCell(product.id, e.target.value);
              }}
            />
          );
        },
      },
      {
        accessorKey: 'warehouseId',
        header: t('warehouse'),
        cell: ({ getValue }) => warehouseName.get(getValue() as string) ?? (getValue() as string),
      },
      { accessorKey: 'qty', header: t('qty') },
    ],
    [t, tCatalog, warehouseName, productsById, photosByProduct, savingCell],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder={t('filterByProduct')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64"
          />
          <Select value={warehouseId ?? '__all__'} onValueChange={(v) => setWarehouseId(v === '__all__' ? undefined : v)}>
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
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setMoveOpen(true)}>
            <ArrowLeftRight className="mr-2 h-4 w-4" />
            {t('moveStock')}
          </Button>
          <Button onClick={() => setMovementOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {t('recordMovement')}
          </Button>
        </div>
      </div>

      {cellError && <p className="text-sm text-destructive">{cellError}</p>}

      <DataTable columns={columns} data={filteredLevels} isLoading={isLoading} />

      <RecordMovementDialog open={movementOpen} onOpenChange={setMovementOpen} />
      <MoveStockDialog open={moveOpen} onOpenChange={setMoveOpen} />
    </div>
  );
}
