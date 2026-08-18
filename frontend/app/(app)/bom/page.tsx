'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { useAssemblies, useAssemblyCosts } from '@/lib/hooks/use-bom';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { useSuppliers } from '@/lib/hooks/use-procurement';
import { useHasPermission } from '@/lib/hooks/use-roles';
import { formatEur } from '@/lib/utils';
import type { Assembly } from '@/lib/api-client/bom';
import { DataTable } from '@/components/domain/data-table/data-table';
import { ColumnVisibilityMenu } from '@/components/domain/data-table/column-visibility-menu';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';

const PAGE_SIZE = 50;
// Bumped from the original key: new optional columns below should start
// hidden by default (matching the pre-existing name/article/laborCostPerUnit
// default view), which only works cleanly for a key nothing has written to
// yet — reusing the old key would show them all at once for anyone who'd
// already saved a (now stale) preference under it.
const HIDDEN_COLUMNS_KEY = 'sh-erp-bom-hidden-columns-v2';
const DEFAULT_HIDDEN_COLUMNS = [
  'note',
  'packagingCostPerUnit',
  'deliveryCostPerUnit',
  'otherCostPerUnit',
  'supplier',
  'createdAt',
  'itemCost',
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

export default function BomPage() {
  const t = useTranslations('bom');
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(loadHiddenColumns);

  const columnOptions = useMemo(
    () => [
      { id: 'name', label: t('name') },
      { id: 'article', label: t('article') },
      { id: 'laborCostPerUnit', label: t('laborCostPerUnit') },
      { id: 'note', label: t('note') },
      { id: 'packagingCostPerUnit', label: t('packagingCostPerUnit') },
      { id: 'deliveryCostPerUnit', label: t('deliveryCostPerUnit') },
      { id: 'otherCostPerUnit', label: t('otherCostPerUnit') },
      { id: 'supplier', label: t('supplier') },
      { id: 'createdAt', label: t('createdAt') },
      { id: 'itemCost', label: t('itemCost') },
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

  const { data, isLoading } = useAssemblies({ search: search || undefined, limit: PAGE_SIZE, offset });
  const { data: suppliers } = useSuppliers({ limit: 200 });

  const assemblyIds = useMemo(() => data?.items.map((a) => a.id) ?? [], [data]);
  const { data: photosByAssembly } = useFilesForEntities('Assembly', assemblyIds, 'ASSEMBLY_PHOTO');
  // Full BOM-derived cost (materials + labor + packaging + delivery +
  // other), the same computation the Собівартість tab and every price
  // estimate elsewhere in the app already use — not a stored column, so
  // it's fetched per row only when this column is actually shown (it
  // starts hidden), same "cheap per-row calls, not hundreds at once"
  // reasoning as useAssemblyCosts' own header comment.
  const itemCosts = useAssemblyCosts(hiddenColumns.has('itemCost') ? [] : assemblyIds);

  const supplierById = useMemo(() => {
    const map = new Map<string, string>();
    suppliers?.items.forEach((s) => map.set(s.id, s.name));
    return map;
  }, [suppliers]);

  const columns = useMemo<ColumnDef<Assembly>[]>(
    () => [
      {
        id: 'photo',
        header: '',
        cell: ({ row }) => <Avatar src={photosByAssembly?.[row.original.id]?.[0]?.downloadUrl} size="xl" />,
      },
      { accessorKey: 'name', header: t('name') },
      { accessorKey: 'article', header: t('article'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      {
        accessorKey: 'laborCostPerUnit',
        header: t('laborCostPerUnit'),
      },
      { accessorKey: 'note', header: t('note'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      { accessorKey: 'packagingCostPerUnit', header: t('packagingCostPerUnit') },
      { accessorKey: 'deliveryCostPerUnit', header: t('deliveryCostPerUnit') },
      { accessorKey: 'otherCostPerUnit', header: t('otherCostPerUnit') },
      {
        id: 'supplier',
        accessorFn: (row) => row.defaultSupplierId,
        header: t('supplier'),
        cell: ({ getValue }) => {
          const id = getValue() as string | null;
          return id ? (supplierById.get(id) ?? '—') : '—';
        },
      },
      {
        accessorKey: 'createdAt',
        header: t('createdAt'),
        cell: ({ getValue }) => new Date(getValue() as string).toLocaleDateString(),
      },
      {
        id: 'itemCost',
        header: t('itemCost'),
        cell: ({ row }) => {
          const result = itemCosts[row.index];
          if (result?.isLoading) return '…';
          const cost = result?.data?.costPerUnit;
          return cost != null ? formatEur(cost) : '—';
        },
      },
    ],
    [t, photosByAssembly, supplierById, itemCosts],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        {useHasPermission('assemblies:write') && (
          <Button asChild>
            <Link href="/bom/new" data-tour="bom-new-button">
              <Plus className="mr-2 h-4 w-4" />
              {t('newAssembly')}
            </Link>
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          placeholder={t('searchPlaceholder')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
          className="max-w-sm"
        />
        <ColumnVisibilityMenu columns={columnOptions} hidden={hiddenColumns} onToggle={toggleColumn} />
      </div>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        onRowClick={(assembly) => router.push(`/bom/${assembly.id}`)}
        pagination={data ? { offset, limit: PAGE_SIZE, total: data.total, onOffsetChange: setOffset } : undefined}
        hiddenColumnIds={hiddenColumns}
      />
    </div>
  );
}
