'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Copy, Trash2 } from 'lucide-react';
import { useQuotations, useDuplicateQuotation, useDeleteQuotation } from '@/lib/hooks/use-quotations';
import { formatMoney } from '@/lib/finance-format';
import type { QuotationListItem, QuotationStatus } from '@/lib/api-client/quotations';
import { DataTable } from '@/components/domain/data-table/data-table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { useHasPermission } from '@/lib/hooks/use-roles';

const PAGE_SIZE = 50;

const STATUS_VARIANT: Record<QuotationStatus, 'secondary' | 'warning' | 'success' | 'destructive' | 'default'> = {
  DRAFT: 'secondary',
  SENT: 'default',
  VIEWED: 'warning',
  ACCEPTED: 'success',
  REJECTED: 'destructive',
};

export default function QuotationsPage() {
  const t = useTranslations('quotations');
  const tc = useTranslations('common');
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<QuotationStatus | undefined>(undefined);
  const [offset, setOffset] = useState(0);
  const canManage = useHasPermission('quotations:manage');
  const duplicateQuotation = useDuplicateQuotation();
  const deleteQuotation = useDeleteQuotation();

  const { data, isLoading } = useQuotations({ search: search || undefined, status, limit: PAGE_SIZE, offset });

  async function handleDuplicate(id: string) {
    const created = await duplicateQuotation.mutateAsync(id);
    router.push(`/quotations/${created.id}`);
  }

  async function handleDelete(id: string) {
    if (!window.confirm(t('confirmDelete'))) return;
    await deleteQuotation.mutateAsync(id);
  }

  const columns = useMemo<ColumnDef<QuotationListItem>[]>(
    () => [
      { accessorKey: 'number', header: t('number') },
      { accessorKey: 'customerName', header: t('customer') },
      {
        accessorKey: 'status',
        header: t('status'),
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="flex items-center gap-1.5">
              <Badge variant={STATUS_VARIANT[item.status]}>{t(`quotationStatus${item.status}`)}</Badge>
              {item.isExpired && <Badge variant="destructive">{t('quotationStatusEXPIRED')}</Badge>}
            </div>
          );
        },
      },
      {
        accessorKey: 'total',
        header: t('total'),
        cell: ({ row }) => formatMoney(row.original.total, row.original.currency),
      },
      {
        accessorKey: 'validUntil',
        header: t('validUntil'),
        cell: ({ getValue }) => (getValue() ? new Date(getValue() as string).toLocaleDateString() : '—'),
      },
      {
        accessorKey: 'createdAt',
        header: t('createdAt'),
        cell: ({ getValue }) => new Date(getValue() as string).toLocaleDateString(),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) =>
          canManage ? (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title={t('duplicate')}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleDuplicate(row.original.id);
                }}
                disabled={duplicateQuotation.isPending}
              >
                <Copy className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
                title={tc('delete')}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleDelete(row.original.id);
                }}
                disabled={deleteQuotation.isPending}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ) : null,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, canManage, duplicateQuotation.isPending, deleteQuotation.isPending],
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
          <Select
            value={status ?? '__all'}
            onValueChange={(v) => {
              setStatus(v === '__all' ? undefined : (v as QuotationStatus));
              setOffset(0);
            }}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder={t('filterByStatus')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">{t('allStatuses')}</SelectItem>
              <SelectItem value="DRAFT">{t('quotationStatusDRAFT')}</SelectItem>
              <SelectItem value="SENT">{t('quotationStatusSENT')}</SelectItem>
              <SelectItem value="VIEWED">{t('quotationStatusVIEWED')}</SelectItem>
              <SelectItem value="ACCEPTED">{t('quotationStatusACCEPTED')}</SelectItem>
              <SelectItem value="REJECTED">{t('quotationStatusREJECTED')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {canManage && (
          <Button asChild>
            <Link href="/quotations/new">
              <Plus className="mr-2 h-4 w-4" />
              {t('newQuotation')}
            </Link>
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        onRowClick={(item) => router.push(`/quotations/${item.id}`)}
        pagination={data ? { offset, limit: PAGE_SIZE, total: data.total, onOffsetChange: setOffset } : undefined}
      />
    </div>
  );
}
