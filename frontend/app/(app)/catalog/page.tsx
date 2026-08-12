'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Settings2, Upload, Download, Tag, Grid3x3, Trash2 } from 'lucide-react';
import { useProducts, useExportProducts, useDeleteProducts } from '@/lib/hooks/use-catalog';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import type { Product } from '@/lib/api-client/catalog';
import { DataTable } from '@/components/domain/data-table/data-table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
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

const PAGE_SIZE = 50;

export default function CatalogPage() {
  const t = useTranslations('catalog');
  const tc = useTranslations('common');
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const exportMutation = useExportProducts();
  const deleteMutation = useDeleteProducts();

  const { data, isLoading } = useProducts({ search: search || undefined, limit: PAGE_SIZE, offset });

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
            <Link href="/catalog/new">
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
