'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { ArrowLeftRight, Plus } from 'lucide-react';
import { useStockLevels, useWarehouses, useRecordStockMovement } from '@/lib/hooks/use-inventory';
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
import { ReservationBreakdownPopover } from '@/components/domain/inventory/reservation-breakdown-popover';
import { LearnThisButton } from '@/components/domain/training/learn-this-button';
import { useHasPermission } from '@/lib/hooks/use-roles';
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
  const [savingQty, setSavingQty] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const { data: warehouses } = useWarehouses();
  const { data: levels, isLoading } = useStockLevels({ warehouseId });
  const recordMovement = useRecordStockMovement();
  const canAdjustStock = useHasPermission('stock:adjust');
  const canWriteProducts = useHasPermission('products:write');

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
    setRowError(null);
    setSavingCell(productId);
    try {
      await updateProduct(productId, { cell: value });
      qc.invalidateQueries({ queryKey: ['products'] });
    } catch (err) {
      setRowError(apiErrorMessage(err, tc('error')));
    } finally {
      setSavingCell(null);
    }
  }

  // Quantity is never a directly-writable field (schema.prisma) — every
  // change goes through StockService.applyMovement as an audited
  // StockMovement, ADJUST being the type meant for exactly this manual
  // correction. This computes the delta from the target quantity the user
  // typed and reuses the same POST /stock/movements the "Рух товару" dialog
  // already calls, just without making the user pick product+warehouse
  // (the row already is one) or compute the delta themselves.
  async function saveQty(stock: WarehouseStock, rawValue: string) {
    setRowError(null);
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setRowError(tc('error'));
      return;
    }
    const current = Number(stock.qty);
    const delta = parsed - current;
    if (delta === 0) return;
    setSavingQty(stock.id);
    try {
      await recordMovement.mutateAsync({
        productId: stock.productId,
        warehouseId: stock.warehouseId,
        type: 'ADJUST',
        qtyDelta: delta,
        comment: t('qtyEditComment'),
      });
    } catch (err) {
      setRowError(apiErrorMessage(err, tc('error')));
    } finally {
      setSavingQty(null);
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
              // Keyed on the value itself: this Input is uncontrolled
              // (defaultValue only applies on mount), so after a successful
              // save + refetch it would otherwise keep showing the old
              // value the user typed over until a full page reload — force
              // a remount when the source-of-truth value actually changes.
              key={`${row.original.productId}-${product?.cell ?? ''}`}
              defaultValue={product?.cell ?? ''}
              disabled={!product || !canWriteProducts}
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
      {
        accessorKey: 'qty',
        header: () => <span className="block text-right">{t('qty')}</span>,
        cell: ({ row }) => (
          <Input
            // Same uncontrolled-input staleness fix as the "cell" column
            // above: remount when the row's actual qty changes so a
            // successful ADJUST movement is reflected without a reload.
            key={`${row.original.id}-${row.original.qty}`}
            type="number"
            step="any"
            min={0}
            defaultValue={row.original.qty}
            disabled={savingQty === row.original.id || !canAdjustStock}
            className={cn('h-8 w-24 text-right tabular-nums', savingQty === row.original.id && 'opacity-50')}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              if (e.target.value === row.original.qty) return;
              saveQty(row.original, e.target.value);
            }}
          />
        ),
      },
      {
        accessorKey: 'reservedQty',
        header: () => <span className="block text-right">{t('reservedQty')}</span>,
        cell: ({ row }) => (
          <div className="text-right tabular-nums">
            <ReservationBreakdownPopover productId={row.original.productId} warehouseId={row.original.warehouseId} qty={Number(row.original.reservedQty)}>
              {row.original.reservedQty}
            </ReservationBreakdownPopover>
          </div>
        ),
      },
      {
        accessorKey: 'availableQty',
        header: () => <span className="block text-right">{t('availableQty')}</span>,
        cell: ({ row }) => <div className="text-right tabular-nums font-medium">{row.original.availableQty}</div>,
      },
      {
        accessorKey: 'globalShortageQty',
        header: () => <span className="block text-right">{t('globalShortageQty')}</span>,
        cell: ({ row }) =>
          Number(row.original.globalShortageQty) > 0 ? (
            <div className="text-right tabular-nums font-medium text-destructive">{row.original.globalShortageQty}</div>
          ) : (
            <div className="text-right tabular-nums text-muted-foreground">0</div>
          ),
      },
    ],
    [t, tCatalog, warehouseName, productsById, photosByProduct, savingCell, savingQty, canWriteProducts, canAdjustStock],
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
          <LearnThisButton courseId="warehouse" label="Навчитися працювати зі складом" />
          {canAdjustStock && (
            <>
              <Button variant="outline" onClick={() => setMoveOpen(true)}>
                <ArrowLeftRight className="mr-2 h-4 w-4" />
                {t('moveStock')}
              </Button>
              <Button onClick={() => setMovementOpen(true)} data-tour="inventory-record-movement-button">
                <Plus className="mr-2 h-4 w-4" />
                {t('recordMovement')}
              </Button>
            </>
          )}
        </div>
      </div>

      {rowError && <p className="text-sm text-destructive">{rowError}</p>}

      <div data-tour="inventory-levels-table">
        <DataTable columns={columns} data={filteredLevels} isLoading={isLoading} />
      </div>

      {canAdjustStock && (
        <>
          <RecordMovementDialog open={movementOpen} onOpenChange={setMovementOpen} />
          <MoveStockDialog open={moveOpen} onOpenChange={setMoveOpen} />
        </>
      )}
    </div>
  );
}
