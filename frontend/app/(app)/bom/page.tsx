'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { useAssemblies } from '@/lib/hooks/use-bom';
import type { Assembly } from '@/lib/api-client/bom';
import { DataTable } from '@/components/domain/data-table/data-table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const PAGE_SIZE = 50;

export default function BomPage() {
  const t = useTranslations('bom');
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);

  const { data, isLoading } = useAssemblies({ search: search || undefined, limit: PAGE_SIZE, offset });

  const columns = useMemo<ColumnDef<Assembly>[]>(
    () => [
      { accessorKey: 'name', header: t('name') },
      { accessorKey: 'article', header: t('article'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      {
        accessorKey: 'laborCostPerUnit',
        header: t('laborCostPerUnit'),
      },
    ],
    [t],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <Button asChild>
          <Link href="/bom/new">
            <Plus className="mr-2 h-4 w-4" />
            {t('newAssembly')}
          </Link>
        </Button>
      </div>

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
        onRowClick={(assembly) => router.push(`/bom/${assembly.id}`)}
        pagination={data ? { offset, limit: PAGE_SIZE, total: data.total, onOffsetChange: setOffset } : undefined}
      />
    </div>
  );
}
