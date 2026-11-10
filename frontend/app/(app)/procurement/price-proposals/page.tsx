'use client';

import { useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { usePriceProposals, useApprovePriceProposal, useRejectPriceProposal } from '@/lib/hooks/use-procurement';
import type { PriceProposal } from '@/lib/api-client/procurement';
import { DataTable } from '@/components/domain/data-table/data-table';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { formatEur } from '@/lib/utils';
import { useApiErrorMessage } from '@/lib/api-error-message';

/**
 * "правка ціни щоб було тільки через підтвердження в основній erp"
 * (2026-11-10) — the review queue for price changes proposed from the
 * Telegram sourcing Mini App (`SourcingAppService#createPriceProposal`).
 * Approving here is the ONLY code path that ever copies a proposed price
 * into `ProductSupplier.price` — the Mini App itself can only create a
 * row, never write the real price directly.
 */
export default function PriceProposalsPage() {
  const t = useTranslations('procurement');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const { data, isLoading } = usePriceProposals();
  const approve = useApprovePriceProposal();
  const reject = useRejectPriceProposal();
  const [actionError, setActionError] = useState<string | null>(null);

  const handleApprove = useCallback(
    async (id: string) => {
      setActionError(null);
      try {
        await approve.mutateAsync(id);
      } catch (err) {
        setActionError(apiErrorMessage(err, tc('error')));
      }
    },
    [approve, apiErrorMessage, tc],
  );

  const handleReject = useCallback(
    async (id: string) => {
      setActionError(null);
      try {
        await reject.mutateAsync(id);
      } catch (err) {
        setActionError(apiErrorMessage(err, tc('error')));
      }
    },
    [reject, apiErrorMessage, tc],
  );

  const columns = useMemo<ColumnDef<PriceProposal>[]>(
    () => [
      {
        accessorKey: 'product',
        header: t('product'),
        cell: ({ row }) => `${row.original.product.article} — ${row.original.product.name}`,
      },
      {
        accessorKey: 'supplier',
        header: t('suppliers'),
        cell: ({ row }) => row.original.supplier.name,
      },
      {
        accessorKey: 'proposedPriceEur',
        header: t('proposedPrice'),
        cell: ({ getValue }) => formatEur(getValue() as number),
      },
      {
        accessorKey: 'note',
        header: t('note'),
        cell: ({ getValue }) => (getValue() as string | null) ?? '—',
      },
      {
        accessorKey: 'createdAt',
        header: t('proposedAt'),
        cell: ({ getValue }) => new Date(getValue() as string).toLocaleString(),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex justify-end gap-2">
            <Dialog>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">{t('reject')}</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('rejectPriceProposalConfirmTitle')}</DialogTitle>
                  <DialogDescription>{t('rejectPriceProposalConfirmDescription')}</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">{tc('cancel')}</Button>
                  </DialogClose>
                  <Button variant="destructive" loading={reject.isPending} onClick={() => handleReject(row.original.id)}>
                    {t('reject')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog>
              <DialogTrigger asChild>
                <Button size="sm">{t('approve')}</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('approvePriceProposalConfirmTitle')}</DialogTitle>
                  <DialogDescription>{t('approvePriceProposalConfirmDescription')}</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">{tc('cancel')}</Button>
                  </DialogClose>
                  <Button loading={approve.isPending} onClick={() => handleApprove(row.original.id)}>
                    {t('approve')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        ),
      },
    ],
    [t, tc, approve.isPending, reject.isPending, handleApprove, handleReject],
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('priceProposalsNote')}</p>
      {actionError && <p className="text-sm text-destructive">{actionError}</p>}
      <DataTable
        columns={columns}
        data={data ?? []}
        isLoading={isLoading}
        emptyState={<p className="p-6 text-center text-sm text-muted-foreground">{t('noPriceProposals')}</p>}
      />
    </div>
  );
}
