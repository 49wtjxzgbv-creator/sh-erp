'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { usePurchaseRequests } from '@/lib/hooks/use-procurement';
import type { PurchaseRequest, PurchaseRequestStatus } from '@/lib/api-client/procurement';
import { DataTable } from '@/components/domain/data-table/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { useHasPermission } from '@/lib/hooks/use-roles';

const PAGE_SIZE = 50;

const STATUS_VARIANT: Record<PurchaseRequestStatus, 'secondary' | 'warning' | 'success' | 'destructive'> = {
  DRAFT: 'secondary',
  SENT: 'warning',
  CONVERTED: 'success',
  CANCELLED: 'destructive',
};

export default function PurchaseRequestsPage() {
  const t = useTranslations('procurement');
  const router = useRouter();
  const [status, setStatus] = useState<PurchaseRequestStatus | undefined>(undefined);
  const [offset, setOffset] = useState(0);

  const { data, isLoading } = usePurchaseRequests({ status, limit: PAGE_SIZE, offset });

  const columns = useMemo<ColumnDef<PurchaseRequest>[]>(
    () => [
      { accessorKey: 'number', header: t('requestNumber') },
      { accessorKey: 'supplierNameSnapshot', header: t('supplier') },
      {
        accessorKey: 'status',
        header: t('status'),
        cell: ({ getValue }) => {
          const s = getValue() as PurchaseRequestStatus;
          return <Badge variant={STATUS_VARIANT[s]}>{t(`prStatus${s}`)}</Badge>;
        },
      },
      {
        accessorKey: 'createdAt',
        header: t('createdAt'),
        cell: ({ getValue }) => new Date(getValue() as string).toLocaleDateString(),
      },
    ],
    [t],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select value={status ?? '__all'} onValueChange={(v) => { setStatus(v === '__all' ? undefined : (v as PurchaseRequestStatus)); setOffset(0); }}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder={t('filterByStatus')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">{t('allStatuses')}</SelectItem>
            <SelectItem value="DRAFT">{t('prStatusDRAFT')}</SelectItem>
            <SelectItem value="SENT">{t('prStatusSENT')}</SelectItem>
            <SelectItem value="CONVERTED">{t('prStatusCONVERTED')}</SelectItem>
            <SelectItem value="CANCELLED">{t('prStatusCANCELLED')}</SelectItem>
          </SelectContent>
        </Select>
        {useHasPermission('purchase-requests:manage') && (
          <Button asChild>
            <Link href="/procurement/requests/new">
              <Plus className="mr-2 h-4 w-4" />
              {t('newPurchaseRequest')}
            </Link>
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        onRowClick={(pr) => router.push(`/procurement/requests/${pr.id}`)}
        pagination={data ? { offset, limit: PAGE_SIZE, total: data.total, onOffsetChange: setOffset } : undefined}
      />
    </div>
  );
}
