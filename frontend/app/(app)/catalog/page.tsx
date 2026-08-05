'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Settings2, Upload, Download, Tag, Grid3x3 } from 'lucide-react';
import { useProducts, useExportProducts } from '@/lib/hooks/use-catalog';
import type { Product } from '@/lib/api-client/catalog';
import { DataTable } from '@/components/domain/data-table/data-table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
  const exportMutation = useExportProducts();

  const { data, isLoading } = useProducts({ search: search || undefined, limit: PAGE_SIZE, offset });

  const columns = useMemo<ColumnDef<Product>[]>(
    () => [
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
    [t],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <div className="flex flex-wrap gap-2">
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

      <Input
        placeholder={t('searchPlaceholder')}
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setOffset(0);
        }}
        className="max-w-sm"
      />

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        onRowClick={(product) => router.push(`/catalog/${product.id}`)}
        pagination={
          data
            ? { offset, limit: PAGE_SIZE, total: data.total, onOffsetChange: setOffset }
            : undefined
        }
      />
    </div>
  );
}
