'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { useEmployees } from '@/lib/hooks/use-hr';
import type { Employee, EmployeeStatus } from '@/lib/api-client/hr';
import { DataTable } from '@/components/domain/data-table/data-table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

const PAGE_SIZE = 50;

export default function EmployeesPage() {
  const t = useTranslations('hr');
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<EmployeeStatus>('ACTIVE');
  const [offset, setOffset] = useState(0);

  const { data, isLoading } = useEmployees({ search: search || undefined, status, limit: PAGE_SIZE, offset });

  const columns = useMemo<ColumnDef<Employee>[]>(
    () => [
      { accessorKey: 'fullName', header: t('fullName') },
      { accessorKey: 'position', header: t('position'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      { accessorKey: 'phone', header: t('phone'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
      {
        accessorKey: 'status',
        header: t('status'),
        cell: ({ getValue }) => {
          const s = getValue() as EmployeeStatus;
          return <Badge variant={s === 'ACTIVE' ? 'success' : 'secondary'}>{t(`employeeStatus${s}`)}</Badge>;
        },
      },
    ],
    [t],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
            className="max-w-sm"
          />
          <Select value={status} onValueChange={(v) => { setStatus(v as EmployeeStatus); setOffset(0); }}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ACTIVE">{t('employeeStatusACTIVE')}</SelectItem>
              <SelectItem value="INACTIVE">{t('employeeStatusINACTIVE')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button asChild>
          <Link href="/hr/new">
            <Plus className="mr-2 h-4 w-4" />
            {t('newEmployee')}
          </Link>
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        onRowClick={(employee) => router.push(`/hr/${employee.id}`)}
        pagination={data ? { offset, limit: PAGE_SIZE, total: data.total, onOffsetChange: setOffset } : undefined}
      />
    </div>
  );
}
