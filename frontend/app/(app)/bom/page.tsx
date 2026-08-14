'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { useAssemblies } from '@/lib/hooks/use-bom';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import type { Assembly } from '@/lib/api-client/bom';
import { DataTable } from '@/components/domain/data-table/data-table';
import { ColumnVisibilityMenu } from '@/components/domain/data-table/column-visibility-menu';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';

const PAGE_SIZE = 50;
const HIDDEN_COLUMNS_KEY = 'sh-erp-bom-hidden-columns';

function loadHiddenColumns(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(HIDDEN_COLUMNS_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
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

  const assemblyIds = useMemo(() => data?.items.map((a) => a.id) ?? [], [data]);
  const { data: photosByAssembly } = useFilesForEntities('Assembly', assemblyIds, 'ASSEMBLY_PHOTO');

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
    ],
    [t, photosByAssembly],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <Button asChild>
          <Link href="/bom/new" data-tour="bom-new-button">
            <Plus className="mr-2 h-4 w-4" />
            {t('newAssembly')}
          </Link>
        </Button>
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
