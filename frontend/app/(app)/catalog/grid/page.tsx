'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Eye, ListChecks, Trash2 } from 'lucide-react';
import { useProducts, useCompanyUnits } from '@/lib/hooks/use-catalog';
import { updateProduct, bulkDeleteProducts, type Product } from '@/lib/api-client/catalog';
import { useWarehouses } from '@/lib/hooks/use-inventory';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { recordStockMovement } from '@/lib/api-client/inventory';
import { ApiError } from '@/lib/api-client/types';
import { LoadingBlock } from '@/components/ui/loading-block';
import { Avatar } from '@/components/ui/avatar';
import {
  PRODUCT_GRID_COLUMNS,
  FILTERABLE_COLUMNS,
  filterProductsByFieldValues,
  distinctFieldValues,
  type GridColumn,
} from '@/components/domain/catalog/product-grid-columns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/**
 * Dense inline-editable grid view of Products — ported from legacy's
 * "Таблиця товарів" (`spreadsheet.html`/`JavaScript.html`'s admin-editor
 * section, `SS_COLUMNS`/`renderSpreadsheetGrid_`/`ssCellChanged_`). See
 * `product-grid-columns.ts`'s header comment for the three schema-driven
 * deviations (unit is now a real FK dropdown, no photo column, no
 * usedInAssemblies).
 *
 * Two more deliberate, disclosed scope boundaries versus legacy, found
 * while reading `JavaScript.html`'s spreadsheet section in full before
 * building:
 *  - **No `getFilterOptions` server endpoint exists in this backend** —
 *    legacy fetched the filter dropdowns' option lists from the server;
 *    this computes them client-side from whatever page of products is
 *    already loaded (`distinctFieldValues`), which is actually simpler and
 *    avoids a new endpoint, at the cost of only reflecting values present
 *    on the currently-loaded page rather than the whole company.
 *  - **A 200-row cap (`QueryProductsDto`'s own `@Max(200)` limit), not
 *    true "load everything."** Legacy's `loadSpreadsheet()` fetched the
 *    entire unfiltered catalog into one table with zero pagination and
 *    zero performance consideration anywhere in the source (confirmed —
 *    no limit/offset/virtualization code exists in the legacy grid at
 *    all). This backend's product-list endpoint caps at 200 per request
 *    regardless, so this view inherits that ceiling rather than fighting
 *    it — a company with more than 200 products would need real
 *    server-side pagination added to this grid, flagged here as a known
 *    v1 boundary rather than silently truncating without a note.
 *  - **Bulk delete is one request, `POST /products/bulk-delete`** (added
 *    alongside this grid's own select-all/delete UI, matching legacy's
 *    dedicated `deleteProductsBulk` RPC). The first version of this fired
 *    N parallel `DELETE /products/:id` calls instead — a real incident: a
 *    "select all" delete of a full catalog blew through the backend's
 *    per-client rate limit (100 req/60s), so only a couple of requests
 *    fit under whatever budget was left and the rest silently 429'd.
 */
export default function ProductGridPage() {
  const t = useTranslations('catalog');
  const tc = useTranslations('common');
  const qc = useQueryClient();

  const { data, isLoading } = useProducts({ limit: 200 });
  const { data: units } = useCompanyUnits();
  const { data: warehouses } = useWarehouses();
  const defaultWarehouse = warehouses?.find((w) => w.isDefault);

  const [rows, setRows] = useState<Product[]>([]);
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current || !data) return;
    hydrated.current = true;
    setRows(data.items);
  }, [data]);

  const [filters, setFilters] = useState<Record<string, string>>({});
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(
    () => new Set(PRODUCT_GRID_COLUMNS.filter((c) => c.basic).map((c) => c.key)),
  );
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [jumpQuery, setJumpQuery] = useState('');
  const [jumpOpen, setJumpOpen] = useState(false);
  const [savingCell, setSavingCell] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const visibleColumns = PRODUCT_GRID_COLUMNS.filter((c) => visibleKeys.has(c.key));
  const filteredRows = useMemo(() => filterProductsByFieldValues(rows, filters), [rows, filters]);

  // Same "one batch request for every row's photo" pattern as the plain
  // Catalog list — see files.service.ts#listForEntities's header comment.
  const productIds = useMemo(() => rows.map((p) => p.id), [rows]);
  const { data: photosByProduct } = useFilesForEntities('Product', productIds, 'PRODUCT_PHOTO');

  const allFilteredSelected = filteredRows.length > 0 && filteredRows.every((p) => selected.has(p.id));
  const someFilteredSelected = filteredRows.some((p) => selected.has(p.id));

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filteredRows.forEach((p) => next.delete(p.id));
      else filteredRows.forEach((p) => next.add(p.id));
      return next;
    });
  }

  // No query yet (just focused) shows the first page of currently-loaded
  // rows rather than nothing — same "open it, see positions immediately"
  // behavior as the picker components and the header search.
  const jumpMatches = useMemo(() => {
    const q = jumpQuery.trim().toLowerCase();
    if (!q) return filteredRows.slice(0, 30);
    return filteredRows
      .filter((p) => p.article.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || (p.code ?? '').toLowerCase().includes(q))
      .slice(0, 30);
  }, [filteredRows, jumpQuery]);

  function jumpTo(productId: string) {
    setJumpQuery('');
    setJumpOpen(false);
    const el = document.querySelector<HTMLElement>(`[data-product-row="${productId}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('bg-primary/20');
    setTimeout(() => el.classList.remove('bg-primary/20'), 2500);
  }

  async function saveCell(product: Product, column: GridColumn, rawValue: string) {
    setError(null);
    setSavingCell(`${product.id}:${column.key}`);
    try {
      if (column.special === 'qty') {
        if (!defaultWarehouse) throw new Error(t('noDefaultWarehouseForGrid'));
        const newQty = Number(rawValue) || 0;
        const delta = newQty - Number(product.qty);
        if (delta !== 0) {
          await recordStockMovement({
            productId: product.id,
            warehouseId: defaultWarehouse.id,
            type: 'ADJUST',
            qtyDelta: delta,
            comment: t('gridQtyAdjustComment'),
          });
        }
        setRows((prev) => prev.map((p) => (p.id === product.id ? { ...p, qty: String(newQty) } : p)));
      } else {
        const field = column.key as string;
        const value = column.type === 'number' ? (rawValue === '' ? undefined : Number(rawValue)) : rawValue;
        const updated = await updateProduct(product.id, { [field]: value } as any);
        setRows((prev) => prev.map((p) => (p.id === product.id ? updated : p)));
      }
      qc.invalidateQueries({ queryKey: ['products'] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('error'));
    } finally {
      setSavingCell(null);
    }
  }

  function toggleSelected(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleBulkDelete() {
    setDeleting(true);
    setError(null);
    const ids = [...selected];
    try {
      const { deletedCount } = await bulkDeleteProducts(ids);
      setRows((prev) => prev.filter((p) => !ids.includes(p.id)));
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['products'] });
      const missing = ids.length - deletedCount;
      if (missing > 0) setError(t('gridBulkDeletePartialFailure', { count: missing }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('error'));
    }
    setDeleting(false);
    setDeleteConfirmOpen(false);
  }

  if (isLoading) return <LoadingBlock />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/catalog"><ArrowLeft className="mr-2 h-4 w-4" />{t('title')}</Link>
          </Button>
          <h1 className="text-lg font-semibold">{t('gridViewTitle')}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Input
              placeholder={t('gridJumpSearchPlaceholder')}
              value={jumpQuery}
              onChange={(e) => setJumpQuery(e.target.value)}
              onFocus={() => setJumpOpen(true)}
              onBlur={() => setTimeout(() => setJumpOpen(false), 150)}
              className="w-64"
            />
            {jumpOpen && jumpMatches.length > 0 && (
              <div className="absolute z-40 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover shadow-md">
                {jumpMatches.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      jumpTo(p.id);
                    }}
                    className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-secondary"
                  >
                    <span className="font-medium">{p.article}</span>
                    <span className="text-xs text-muted-foreground">{p.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSelectMode((v) => !v);
              setSelected(new Set());
            }}
          >
            <ListChecks className="mr-2 h-4 w-4" />
            {t('gridSelectMode')}
          </Button>
          {selectMode && selected.size > 0 && (
            <Button variant="destructive" size="sm" onClick={() => setDeleteConfirmOpen(true)}>
              <Trash2 className="mr-2 h-4 w-4" />
              {t('gridDeleteSelected', { count: selected.size })}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setColumnsOpen(true)}>
            <Eye className="mr-2 h-4 w-4" />
            {t('gridColumns')}
          </Button>
        </div>
      </div>

      {FILTERABLE_COLUMNS.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {FILTERABLE_COLUMNS.map((col) => {
            const options = distinctFieldValues(rows, col.key as string);
            return (
              <select
                key={col.key}
                value={filters[col.key as string] ?? ''}
                onChange={(e) => {
                  setFilters((prev) => ({ ...prev, [col.key as string]: e.target.value }));
                  setSelected(new Set());
                }}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">{t(col.labelKey as any)}: {tc('search')}</option>
                {options.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            );
          })}
          {Object.values(filters).some(Boolean) && (
            <Button variant="ghost" size="sm" onClick={() => setFilters({})}>
              {t('gridClearFilters')}
            </Button>
          )}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            {selectMode && (
              <TableHead className="w-8">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someFilteredSelected && !allFilteredSelected;
                  }}
                  onChange={toggleSelectAll}
                  aria-label={tc('selectAll')}
                />
              </TableHead>
            )}
            <TableHead className="w-14">{t('photo')}</TableHead>
            {visibleColumns.map((col) => (
              <TableHead key={col.key} className="whitespace-normal align-bottom" style={{ minWidth: col.width }}>
                {t(col.labelKey as any)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredRows.map((product) => (
            <TableRow key={product.id} data-product-row={product.id}>
              {selectMode && (
                <TableCell>
                  <input
                    type="checkbox"
                    checked={selected.has(product.id)}
                    onChange={(e) => toggleSelected(product.id, e.target.checked)}
                    aria-label={tc('selectRow')}
                  />
                </TableCell>
              )}
              <TableCell>
                <Avatar src={photosByProduct?.[product.id]?.[0]?.downloadUrl} size="sm" />
              </TableCell>
              {visibleColumns.map((col) => (
                <TableCell key={col.key} className={cn(savingCell === `${product.id}:${col.key}` && 'opacity-50')}>
                  {col.type === 'unit' ? (
                    <select
                      defaultValue={product.unitId}
                      onChange={(e) => saveCell(product, col, e.target.value)}
                      style={{ width: col.width }}
                      className="h-8 rounded-md border border-input bg-background px-1 text-sm"
                    >
                      {units?.map((u) => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      type={col.type === 'number' ? 'number' : 'text'}
                      step={col.type === 'number' ? 'any' : undefined}
                      defaultValue={(product as any)[col.key] ?? ''}
                      onBlur={(e) => {
                        const original = (product as any)[col.key] ?? '';
                        if (e.target.value !== String(original)) saveCell(product, col, e.target.value);
                      }}
                      style={{ width: col.width }}
                      className="h-8"
                    />
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={columnsOpen} onOpenChange={setColumnsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('gridColumns')}</DialogTitle>
          </DialogHeader>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setVisibleKeys(new Set(PRODUCT_GRID_COLUMNS.map((c) => c.key)))}>
              {t('gridShowAllColumns')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setVisibleKeys(new Set(PRODUCT_GRID_COLUMNS.filter((c) => c.basic).map((c) => c.key)))}
            >
              {t('gridBasicColumnsOnly')}
            </Button>
          </div>
          <div className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto">
            {PRODUCT_GRID_COLUMNS.map((col) => (
              <label key={col.key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={visibleKeys.has(col.key)}
                  onChange={(e) => {
                    setVisibleKeys((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(col.key);
                      else next.delete(col.key);
                      return next;
                    });
                  }}
                />
                {t(col.labelKey as any)}
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={() => setColumnsOpen(false)}>{tc('close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('gridDeleteConfirmTitle', { count: selected.size })}</DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>{tc('cancel')}</Button>
            <Button variant="destructive" loading={deleting} onClick={handleBulkDelete}>{tc('confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
