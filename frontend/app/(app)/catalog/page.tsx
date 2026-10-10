'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Settings2, Upload, Download, Tag, Grid3x3, Trash2, Euro } from 'lucide-react';
import { useProducts, useExportProducts, useDeleteProducts, useProductsByIds } from '@/lib/hooks/use-catalog';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import type { FileAssetWithUrl } from '@/lib/api-client/files';
import { is3DModelFile, isGlbFile } from '@/components/domain/files/entity-documents-field';
import { ArViewButton } from '@/components/domain/files/ar-view-button';
import { useSuppliers } from '@/lib/hooks/use-procurement';
import { useHasPermission } from '@/lib/hooks/use-roles';
import { SuppliersCell } from '@/components/domain/procurement/suppliers-cell';
import type { Product } from '@/lib/api-client/catalog';
import { DataTable } from '@/components/domain/data-table/data-table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { ImportProductsDialog } from '@/components/domain/catalog/import-products-dialog';
import { GermanPriceImportDialog } from '@/components/domain/catalog/german-price-import-dialog';
import { ProductLabelsDialog } from '@/components/domain/catalog/product-labels-dialog';
import { ProductLabelsPrintContent, expandLabelCopies } from '@/components/domain/catalog/product-labels-print-content';
import { PrintArea } from '@/components/domain/print/print-area';
import { ColumnVisibilityMenu } from '@/components/domain/data-table/column-visibility-menu';
import type { SelectedLabel } from '@/components/domain/catalog/product-labels-dialog';

const PAGE_SIZE = 50;
// Same reasoning as bom/page.tsx's own HIDDEN_COLUMNS_KEY/DEFAULT_HIDDEN_COLUMNS
// comment: new optional columns start hidden so the current default view
// (photo/article/name/category/qty/status) doesn't change for anyone.
const HIDDEN_COLUMNS_KEY = 'sh-erp-catalog-hidden-columns';
const DEFAULT_HIDDEN_COLUMNS = [
  'code',
  'description',
  'productGroup',
  'family',
  'type',
  'kind',
  'productLine',
  'barcode',
  'cell',
  'unitsPerPackage',
  'minQty',
  'sellPriceEur',
  'localPriceExclVat',
  'localPriceInclVat',
  'germanPriceExclVat',
  'germanPriceInclVat',
  'weightPerUnitKg',
  'warrantyMonths',
  'manufacturer',
  'manufacturerCode',
  'countryOfOrigin',
  'priceListRef',
  'note',
  'suppliers',
  'createdAt',
];

function loadHiddenColumns(): Set<string> {
  if (typeof window === 'undefined') return new Set(DEFAULT_HIDDEN_COLUMNS);
  try {
    const raw = window.localStorage.getItem(HIDDEN_COLUMNS_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set(DEFAULT_HIDDEN_COLUMNS);
  } catch {
    return new Set(DEFAULT_HIDDEN_COLUMNS);
  }
}

/**
 * `?print=1&labels=productId:copies,productId:copies,...` — the preview
 * ProductLabelsDialog's own "Переглянути" button opens (see that file's
 * openPreview). Re-resolves each productId against real product data
 * (article/name/cell can't be trusted from the URL) and renders the exact
 * same ProductLabelsPrintContent the dialog itself prints from.
 */
function CatalogLabelsPreview({ payload }: { payload: string }) {
  const parsed = useMemo(
    () =>
      payload
        .split(',')
        .map((pair) => {
          const [productId, copies] = pair.split(':');
          return { productId, copies: Math.max(1, Number(copies) || 1) };
        })
        .filter((p) => p.productId),
    [payload],
  );
  const productIds = useMemo(() => parsed.map((p) => p.productId), [parsed]);
  const { data: productsById } = useProductsByIds(productIds);

  const selected: SelectedLabel[] = parsed
    .map(({ productId, copies }) => {
      const product = productsById?.get(productId);
      if (!product) return null;
      return { productId, article: product.article, code: product.code, name: product.name, cell: product.cell, copies };
    })
    .filter((s): s is SelectedLabel => s !== null);

  return (
    <PrintArea>
      <ProductLabelsPrintContent labelInstances={expandLabelCopies(selected)} />
    </PrintArea>
  );
}

export default function CatalogPage() {
  const t = useTranslations('catalog');
  const tc = useTranslations('common');
  const searchParams = useSearchParams();
  const labelsPreviewPayload = searchParams.get('print') === '1' ? searchParams.get('labels') : null;
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [supplierId, setSupplierId] = useState<string | undefined>(undefined);
  const [offset, setOffset] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [germanPriceImportOpen, setGermanPriceImportOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const exportMutation = useExportProducts();
  const deleteMutation = useDeleteProducts();
  const canWrite = useHasPermission('products:write');
  const canManageUnits = useHasPermission('units:manage');
  const { data: suppliers } = useSuppliers({ limit: 200 });
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(loadHiddenColumns);

  const supplierById = useMemo(() => {
    const map = new Map<string, string>();
    suppliers?.items.forEach((s) => map.set(s.id, s.name));
    return map;
  }, [suppliers]);

  const columnOptions = useMemo(
    () => [
      { id: 'article', label: t('article') },
      { id: 'name', label: t('name') },
      { id: 'category', label: t('category') },
      { id: 'qty', label: t('qty') },
      { id: 'status', label: t('status') },
      { id: 'code', label: t('code') },
      { id: 'description', label: t('description') },
      { id: 'productGroup', label: t('productGroup') },
      { id: 'family', label: t('family') },
      { id: 'type', label: t('type') },
      { id: 'kind', label: t('kind') },
      { id: 'productLine', label: t('productLine') },
      { id: 'barcode', label: t('barcode') },
      { id: 'cell', label: t('cell') },
      { id: 'unitsPerPackage', label: t('unitsPerPackage') },
      { id: 'minQty', label: t('minQty') },
      { id: 'sellPriceEur', label: t('sellPrice') },
      { id: 'localPriceExclVat', label: t('localPriceExclVat') },
      { id: 'localPriceInclVat', label: t('localPriceInclVat') },
      { id: 'germanPriceExclVat', label: t('germanPriceExclVat') },
      { id: 'germanPriceInclVat', label: t('germanPriceInclVat') },
      { id: 'weightPerUnitKg', label: t('weightPerUnitKg') },
      { id: 'warrantyMonths', label: t('warrantyMonths') },
      { id: 'manufacturer', label: t('manufacturer') },
      { id: 'manufacturerCode', label: t('manufacturerCode') },
      { id: 'countryOfOrigin', label: t('countryOfOrigin') },
      { id: 'priceListRef', label: t('priceListRef') },
      { id: 'note', label: t('note') },
      { id: 'suppliers', label: t('suppliersColumn') },
      { id: 'createdAt', label: t('createdAt') },
    ],
    [t],
  );

  function toggleColumn(id: string) {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(HIDDEN_COLUMNS_KEY, JSON.stringify(Array.from(next)));
      } catch {
        // best-effort persistence only
      }
      return next;
    });
  }

  // "newest" (createdAt desc), not the alphabetical default other
  // pickers/dialogs use — a product just created in Catalog otherwise
  // lands wherever its name sorts alphabetically among 100+ products,
  // often past page 1, making it look like it was never created.
  const { data, isLoading } = useProducts({
    search: search || undefined,
    supplierId,
    limit: PAGE_SIZE,
    offset,
    sort: 'newest',
  });

  async function handleBulkDelete() {
    await deleteMutation.mutateAsync([...selectedIds]);
    setSelectedIds(new Set());
    setDeleteConfirmOpen(false);
  }

  // One batch request for every row's photo instead of PAGE_SIZE separate
  // ones — see files.service.ts#listForEntities's header comment.
  const productIds = useMemo(() => data?.items.map((p) => p.id) ?? [], [data]);
  const { data: photosByProduct } = useFilesForEntities('Product', productIds, 'PRODUCT_PHOTO');
  // "а в каталозі просто у кожного товару [AR]" (2026-10-10): same batch
  // pattern as the photo above, just for PRODUCT_DOCUMENT — only `.glb`/
  // `.step` attachments resolve to anything (see `resolveArGlbUrl`), every
  // other document type on the product is simply not found here.
  const { data: modelsByProduct } = useFilesForEntities('Product', productIds, 'PRODUCT_DOCUMENT');

  // Already presigned, real URLs — no export/upload round trip needed the
  // way a BOM part's own standalone .glb (assembly-parts-check-viewer.tsx)
  // does, since a product's 3D model is an actual uploaded document, not a
  // snippet cut out of a bigger assembly file on demand. Always prefers
  // `arOptimizedDownloadUrl` for a .glb — the ONLY variant that renders
  // every duplicate part correctly in iOS AR Quick Look (see
  // GlbOptimizationService's header comment) — falling back to the
  // regular optimized/raw URL only while that variant is still pending. A
  // `.step`-converted file never goes through GlbOptimizationService at
  // all (StepConversionService's own tessellation never instances
  // anything), so `convertedDownloadUrl` is already AR-safe as-is.
  function resolveArGlbUrl(files: FileAssetWithUrl[]): string | null {
    const modelDoc = files.find((f) => is3DModelFile(f.originalName));
    if (!modelDoc) return null;
    if (isGlbFile(modelDoc.originalName)) {
      return modelDoc.arOptimizedDownloadUrl || modelDoc.mobileOptimizedDownloadUrl || modelDoc.optimizedDownloadUrl || modelDoc.downloadUrl;
    }
    return modelDoc.convertedDownloadUrl ?? null;
  }

  const columns = useMemo<ColumnDef<Product>[]>(
    () => [
      {
        id: 'photo',
        header: '',
        cell: ({ row }) => {
          const glbUrl = resolveArGlbUrl(modelsByProduct?.[row.original.id] ?? []);
          return (
            <div className="flex flex-col items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <Avatar src={photosByProduct?.[row.original.id]?.[0]?.downloadUrl} size="xl" />
              {glbUrl && <ArViewButton getGlbUrl={() => Promise.resolve(glbUrl)} className="px-1.5 py-0.5 text-[10px]" />}
            </div>
          );
        },
      },
      { accessorKey: 'article', header: t('article') },
      { accessorKey: 'name', header: t('name') },
      { accessorKey: 'category', header: t('category'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      { accessorKey: 'qty', header: t('qty') },
      {
        accessorKey: 'status',
        header: t('status'),
        cell: ({ getValue }) => {
          const value = getValue() as string | null;
          return value ? <Badge variant="outline">{value}</Badge> : '—';
        },
      },
      { accessorKey: 'code', header: t('code'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      { accessorKey: 'description', header: t('description'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      { accessorKey: 'productGroup', header: t('productGroup'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      { accessorKey: 'family', header: t('family'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      { accessorKey: 'type', header: t('type'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      { accessorKey: 'kind', header: t('kind'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      { accessorKey: 'productLine', header: t('productLine'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      { accessorKey: 'barcode', header: t('barcode'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      { accessorKey: 'cell', header: t('cell'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      { accessorKey: 'unitsPerPackage', header: t('unitsPerPackage'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      { accessorKey: 'minQty', header: t('minQty') },
      { accessorKey: 'sellPriceEur', header: t('sellPrice'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      { accessorKey: 'localPriceExclVat', header: t('localPriceExclVat'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      { accessorKey: 'localPriceInclVat', header: t('localPriceInclVat'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      { accessorKey: 'germanPriceExclVat', header: t('germanPriceExclVat'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      { accessorKey: 'germanPriceInclVat', header: t('germanPriceInclVat'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      { accessorKey: 'weightPerUnitKg', header: t('weightPerUnitKg'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      { accessorKey: 'warrantyMonths', header: t('warrantyMonths'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      { accessorKey: 'manufacturer', header: t('manufacturer'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      { accessorKey: 'manufacturerCode', header: t('manufacturerCode'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      { accessorKey: 'countryOfOrigin', header: t('countryOfOrigin'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      { accessorKey: 'priceListRef', header: t('priceListRef'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      { accessorKey: 'note', header: t('note'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      {
        id: 'suppliers',
        header: t('suppliersColumn'),
        cell: ({ row }) => (
          <SuppliersCell
            entityId={row.original.id}
            entityName={row.original.name}
            suppliers={row.original.resolvedSuppliers ?? []}
            supplierById={supplierById}
          />
        ),
      },
      {
        accessorKey: 'createdAt',
        header: t('createdAt'),
        cell: ({ getValue }) => new Date(getValue() as string).toLocaleDateString(),
      },
    ],
    [t, photosByProduct, modelsByProduct, supplierById],
  );

  if (labelsPreviewPayload) {
    return <CatalogLabelsPreview payload={labelsPreviewPayload} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <div className="flex flex-wrap gap-2">
          {canWrite && selectedIds.size > 0 && (
            <Button variant="destructive" onClick={() => setDeleteConfirmOpen(true)}>
              <Trash2 className="mr-2 h-4 w-4" />
              {t('deleteSelected', { count: selectedIds.size })}
            </Button>
          )}
          <Button variant="outline" onClick={() => exportMutation.mutate()} loading={exportMutation.isPending}>
            <Download className="mr-2 h-4 w-4" />
            {t('exportProducts')}
          </Button>
          {canWrite && (
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />
              {t('importProducts')}
            </Button>
          )}
          {canWrite && (
            <Button variant="outline" onClick={() => setGermanPriceImportOpen(true)}>
              <Euro className="mr-2 h-4 w-4" />
              {t('germanPriceImportTitle')}
            </Button>
          )}
          <Button variant="outline" onClick={() => setLabelsOpen(true)}>
            <Tag className="mr-2 h-4 w-4" />
            {t('printLabels')}
          </Button>
          {canWrite && (
            <Button variant="outline" asChild>
              <Link href="/catalog/grid">
                <Grid3x3 className="mr-2 h-4 w-4" />
                {t('gridViewTitle')}
              </Link>
            </Button>
          )}
          {canManageUnits && (
            <Button variant="outline" asChild>
              <Link href="/catalog/units">
                <Settings2 className="mr-2 h-4 w-4" />
                {t('units')}
              </Link>
            </Button>
          )}
          {canWrite && (
            <Button asChild>
              <Link href="/catalog/new" data-tour="catalog-new-button">
                <Plus className="mr-2 h-4 w-4" />
                {t('newProduct')}
              </Link>
            </Button>
          )}
        </div>
      </div>

      {canWrite && <ImportProductsDialog open={importOpen} onOpenChange={setImportOpen} />}
      {canWrite && <GermanPriceImportDialog open={germanPriceImportOpen} onOpenChange={setGermanPriceImportOpen} />}
      <ProductLabelsDialog open={labelsOpen} onOpenChange={setLabelsOpen} />

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('deleteSelectedConfirmTitle', { count: selectedIds.size })}</DialogTitle>
            <DialogDescription>{t('deleteSelectedConfirmDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{tc('cancel')}</Button>
            </DialogClose>
            <Button variant="destructive" loading={deleteMutation.isPending} onClick={handleBulkDelete}>
              {tc('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder={t('searchPlaceholder')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
            setSelectedIds(new Set());
          }}
          className="max-w-sm"
        />
        <Select
          value={supplierId ?? '__all'}
          onValueChange={(v) => {
            setSupplierId(v === '__all' ? undefined : v);
            setOffset(0);
            setSelectedIds(new Set());
          }}
        >
          <SelectTrigger className="w-56">
            <SelectValue placeholder={t('filterBySupplier')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">{t('allSuppliers')}</SelectItem>
            {suppliers?.items.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ColumnVisibilityMenu columns={columnOptions} hidden={hiddenColumns} onToggle={toggleColumn} />
      </div>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        onRowClick={(product) => router.push(`/catalog/${product.id}`)}
        selection={{ selectedIds, onSelectionChange: setSelectedIds, getRowId: (product) => product.id }}
        hiddenColumnIds={hiddenColumns}
        pagination={
          data
            ? {
                offset,
                limit: PAGE_SIZE,
                total: data.total,
                onOffsetChange: (next) => {
                  setOffset(next);
                  setSelectedIds(new Set());
                },
              }
            : undefined
        }
      />
    </div>
  );
}
