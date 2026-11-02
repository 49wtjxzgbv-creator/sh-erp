'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { DataTable } from '@/components/domain/data-table/data-table';
import { is3DModelFile, isGlbFile } from '@/components/domain/files/entity-documents-field';
import { View3DButton } from '@/components/domain/files/view-3d-button';
import { ArViewButton } from '@/components/domain/files/ar-view-button';
import { supplierPortalApi } from '@/lib/supplier-portal/api';
import type { SupplierCatalogEntry } from '@/lib/api-client/supplier-catalog';
import type { FileAssetWithUrl } from '@/lib/api-client/files';

/**
 * "щоб візуально був як у виробника також з можливістю перегляду 3д
 * моделі та ар на телефоні" (2026-11-02) — same `DataTable` engine +
 * photo/3D/AR column treatment as the staff-side `/catalog` page
 * (`frontend/app/(app)/catalog/page.tsx`), reused directly rather than
 * reinvented: `View3DButton`/`ArViewButton` are the exact same components,
 * `resolveArGlbUrl`'s variant-preference logic copied verbatim (always
 * prefer `arOptimizedDownloadUrl` — the only de-instanced variant that
 * renders correctly in iOS AR Quick Look, see GlbOptimizationService).
 */
function resolveArGlbUrl(files: FileAssetWithUrl[]): string | null {
  const modelDoc = files.find((f) => is3DModelFile(f.originalName));
  if (!modelDoc) return null;
  if (isGlbFile(modelDoc.originalName)) {
    return modelDoc.arOptimizedDownloadUrl || modelDoc.mobileOptimizedDownloadUrl || modelDoc.optimizedDownloadUrl || modelDoc.downloadUrl;
  }
  return modelDoc.convertedDownloadUrl ?? null;
}

export default function SupplierPortalCatalogPage() {
  const t = useTranslations('supplierPortal');
  const router = useRouter();
  const [catalog, setCatalog] = useState<SupplierCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Same swallow-on-error convention as the orders/requests lists.
      const res = await supplierPortalApi.get<{ items: SupplierCatalogEntry[] }>('supplier-portal/catalog');
      setCatalog(res.items);
    } catch {
      setCatalog([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const columns = useMemo<ColumnDef<SupplierCatalogEntry>[]>(
    () => [
      {
        id: 'photo',
        header: '',
        cell: ({ row }) => {
          const files = row.original.files;
          const modelDoc = files.find((f) => is3DModelFile(f.originalName));
          const glbUrl = resolveArGlbUrl(files);
          return (
            <div className="flex flex-col items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <Avatar src={row.original.photoUrl} size="xl" />
              {modelDoc && <View3DButton file={modelDoc} className="px-1.5 py-0.5 text-[10px]" />}
              {glbUrl && <ArViewButton getGlbUrl={() => Promise.resolve(glbUrl)} className="px-1.5 py-0.5 text-[10px]" />}
            </div>
          );
        },
      },
      { accessorKey: 'article', header: t('article') },
      { accessorKey: 'name', header: t('productName') },
      { accessorKey: 'supplierOfferedPrice', header: t('yourPrice'), cell: ({ getValue }) => (getValue() as string | null) ?? '—' },
      {
        id: 'cuttingSpec',
        header: t('cuttingSpecLabel'),
        cell: ({ row }) => (row.original.cuttingSpec ? <Badge variant="secondary">{t('cuttingSpecLabel')}</Badge> : '—'),
      },
    ],
    [t],
  );

  const filteredCatalog = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return catalog;
    return catalog.filter((c) => c.article.toLowerCase().includes(query) || c.name.toLowerCase().includes(query));
  }, [catalog, search]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t('yourCatalog')}</h1>
      <Input placeholder={t('catalogSearchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
      <DataTable
        columns={columns}
        data={filteredCatalog}
        isLoading={loading}
        onRowClick={(row) => router.push(`/supplier-portal/catalog/${row.id}`)}
      />
    </div>
  );
}
