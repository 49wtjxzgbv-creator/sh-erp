'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Settings2, Upload, Download, Tag, Grid3x3, Trash2 } from 'lucide-react';
import { useProducts, useExportProducts, useDeleteProducts, useProductsByIds } from '@/lib/hooks/use-catalog';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { useSuppliers } from '@/lib/hooks/use-procurement';
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
import { ProductLabelsDialog } from '@/components/domain/catalog/product-labels-dialog';
import { ProductLabelsPrintContent, expandLabelCopies } from '@/components/domain/catalog/product-labels-print-content';
import { PrintArea } from '@/components/domain/print/print-area';
import type { SelectedLabel } from '@/components/domain/catalog/product-labels-dialog';

const PAGE_SIZE = 50;

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
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const exportMutation = useExportProducts();
  const deleteMutation = useDeleteProducts();
  const { data: suppliers } = useSuppliers({ limit: 200 });

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

  const columns = useMemo<ColumnDef<Product>[]>(
    () => [
      {
        id: 'photo',
        header: '',
        cell: ({ row }) => <Avatar src={photosByProduct?.[row.original.id]?.[0]?.downloadUrl} size="xl" />,
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
    ],
    [t, photosByProduct],
  );

  if (labelsPreviewPayload) {
    return <CatalogLabelsPreview payload={labelsPreviewPayload} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <div className="flex flex-wrap gap-2">
          {selectedIds.size > 0 && (
            <Button variant="destructive" onClick={() => setDeleteConfirmOpen(true)}>
              <Trash2 className="mr-2 h-4 w-4" />
              {t('deleteSelected', { count: selectedIds.size })}
            </Button>
          )}
          <Button variant="outline" onClick={() => exportMutation.mutate()} loading={exportMutation.isPending}>
            <Download className="mr-2 h-4 w-4" />
            {t('exportProducts')}
          </Button>
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            {t('importProducts')}
          </Button>
          <Button variant="outline" onClick={() => setLabelsOpen(true)}>
            <Tag className="mr-2 h-4 w-4" />
            {t('printLabels')}
          </Button>
          <Button variant="outline" asChild>
            <Link href="/catalog/grid">
              <Grid3x3 className="mr-2 h-4 w-4" />
              {t('gridViewTitle')}
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/catalog/units">
              <Settings2 className="mr-2 h-4 w-4" />
              {t('units')}
            </Link>
          </Button>
          <Button asChild>
            <Link href="/catalog/new" data-tour="catalog-new-button">
              <Plus className="mr-2 h-4 w-4" />
              {t('newProduct')}
            </Link>
          </Button>
        </div>
      </div>

      <ImportProductsDialog open={importOpen} onOpenChange={setImportOpen} />
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
      </div>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        onRowClick={(product) => router.push(`/catalog/${product.id}`)}
        selection={{ selectedIds, onSelectionChange: setSelectedIds, getRowId: (product) => product.id }}
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
