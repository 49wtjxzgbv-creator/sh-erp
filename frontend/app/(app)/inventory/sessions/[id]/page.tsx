'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  useInventorySessions,
  useInventorySessionItems,
  useRecordInventoryCount,
  useCompleteInventorySession,
} from '@/lib/hooks/use-inventory';
import { useProductsByIds } from '@/lib/hooks/use-catalog';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar } from '@/components/ui/avatar';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
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

export default function InventorySessionDetailPage() {
  const params = useParams<{ id: string }>();
  const t = useTranslations('inventory');
  const tCatalog = useTranslations('catalog');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();

  const { data: sessions } = useInventorySessions();
  const session = sessions?.find((s) => s.id === params.id);
  const { data: items, isLoading } = useInventorySessionItems(params.id);
  const recordCount = useRecordInventoryCount(params.id);
  const completeSession = useCompleteInventorySession(params.id);

  // InventorySessionItem is a thin count-ledger row (no Product join) —
  // same productId-resolution shape as Stock Levels' own list.
  const productIds = useMemo(() => Array.from(new Set((items ?? []).map((i) => i.productId))), [items]);
  const { data: productsById } = useProductsByIds(productIds);
  const { data: photosByProduct } = useFilesForEntities('Product', productIds, 'PRODUCT_PHOTO');

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [completeResult, setCompleteResult] = useState<number | null>(null);

  const isOpen = session?.status === 'IN_PROGRESS';

  async function handleCount(productId: string) {
    const value = drafts[productId];
    if (value === undefined || value === '') return;
    setError(null);
    try {
      await recordCount.mutateAsync({ productId, actualQty: Number(value) });
      setDrafts((d) => ({ ...d, [productId]: '' }));
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleComplete() {
    setError(null);
    try {
      const result = await completeSession.mutateAsync();
      setCompleteResult(result.discrepanciesReconciled);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{session?.name ?? '…'}</h1>
          {session && (
            <Badge variant={session.status === 'COMPLETED' ? 'success' : 'outline'} className="mt-1">
              {session.status === 'COMPLETED' ? t('statusCompleted') : t('statusInProgress')}
            </Badge>
          )}
        </div>
        {isOpen && (
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="destructive">{t('completeSession')}</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('completeSession')}</DialogTitle>
                <DialogDescription>{t('completeSessionConfirm')}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">{tc('cancel')}</Button>
                </DialogClose>
                <Button variant="destructive" loading={completeSession.isPending} onClick={handleComplete}>
                  {tc('confirm')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {completeResult !== null && (
        <p className="text-sm text-success">
          {t('discrepanciesReconciled')}: {completeResult}
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10 text-right">{tc('rowNumber')}</TableHead>
            <TableHead>{tCatalog('photo')}</TableHead>
            <TableHead>{tCatalog('article')}</TableHead>
            <TableHead>{tCatalog('name')}</TableHead>
            <TableHead>{t('expectedQty')}</TableHead>
            <TableHead>{t('actualQty')}</TableHead>
            <TableHead>{t('counted')}</TableHead>
            {isOpen && <TableHead>{tc('actions')}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">
                {tc('loading')}
              </TableCell>
            </TableRow>
          ) : !items || items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">
                {tc('noResults')}
              </TableCell>
            </TableRow>
          ) : (
            items.map((item, rowIndex) => {
              const product = productsById?.get(item.productId);
              return (
              <TableRow key={item.id}>
                <TableCell className="text-right text-muted-foreground">{rowIndex + 1}</TableCell>
                <TableCell>
                  <Avatar src={photosByProduct?.[item.productId]?.[0]?.downloadUrl} size="sm" />
                </TableCell>
                <TableCell>{product?.article ?? '—'}</TableCell>
                <TableCell>{product?.name ?? item.productId}</TableCell>
                <TableCell>{item.expectedQty}</TableCell>
                <TableCell>{item.actualQty ?? '—'}</TableCell>
                <TableCell>{item.counted ? '✓' : '—'}</TableCell>
                {isOpen && (
                  <TableCell>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        step="any"
                        className="w-24"
                        value={drafts[item.productId] ?? ''}
                        onChange={(e) => setDrafts((d) => ({ ...d, [item.productId]: e.target.value }))}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        loading={recordCount.isPending}
                        onClick={() => handleCount(item.productId)}
                      >
                        {tc('save')}
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
