'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { useSuppliers } from '@/lib/hooks/use-procurement';
import type { Supplier } from '@/lib/api-client/procurement';
import { DataTable } from '@/components/domain/data-table/data-table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useHasPermission } from '@/lib/hooks/use-roles';

const PAGE_SIZE = 50;

export default function SuppliersPage() {
  const t = useTranslations('procurement');
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);

  const { data, isLoading } = useSuppliers({ search: search || undefined, limit: PAGE_SIZE, offset });

  const columns = useMemo<ColumnDef<Supplier>[]>(
    () => [
      { accessorKey: 'name', header: t('supplierName') },
      { accessorKey: 'contactPerson', header: t('contactPerson'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      { accessorKey: 'phone', header: t('phone'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      { accessorKey: 'email', header: t('email'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
    ],
    [t],
  );

  return (
    <div className="space-y-4">
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
        {useHasPermission('suppliers:write') && (
          <Button asChild>
            <Link href="/procurement/suppliers/new">
              <Plus className="mr-2 h-4 w-4" />
              {t('newSupplier')}
            </Link>
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        onRowClick={(supplier) => router.push(`/procurement/suppliers/${supplier.id}`)}
        pagination={data ? { offset, limit: PAGE_SIZE, total: data.total, onOffsetChange: setOffset } : undefined}
      />
    </div>
  );
}
