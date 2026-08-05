'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { useShipment, useMarkShipmentDelivered, useDeleteShipment } from '@/lib/hooks/use-sales';
import { ApiError } from '@/lib/api-client/types';
import type { ShipmentStatus } from '@/lib/api-client/sales';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { LoadingBlock } from '@/components/ui/loading-block';
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

const STATUS_VARIANT: Record<ShipmentStatus, 'secondary' | 'success'> = {
  SHIPPED: 'secondary',
  DELIVERED: 'success',
};

export default function ShipmentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('sales');
  const tc = useTranslations('common');

  const { data: shipment, isLoading } = useShipment(params.id);
  const markDelivered = useMarkShipmentDelivered(params.id);
  const deleteShipment = useDeleteShipment();
  const [error, setError] = useState<string | null>(null);

  if (isLoading || !shipment) {
    return <LoadingBlock />;
  }

  const isDelivered = shipment.status === 'DELIVERED';

  async function handleMarkDelivered() {
    setError(null);
    try {
      await markDelivered.mutateAsync();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  async function handleDelete() {
    await deleteShipment.mutateAsync(params.id);
    router.replace('/sales/shipments');
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">{shipment.waybillNumber ?? shipment.id}</h2>
          <Badge variant={STATUS_VARIANT[shipment.status]}>{t(`shipmentStatus${shipment.status}`)}</Badge>
        </div>
        {!isDelivered && (
          <div className="flex gap-2">
            <Dialog>
              <DialogTrigger asChild>
                <Button size="sm">{t('markDelivered')}</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('markDeliveredConfirmTitle')}</DialogTitle>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">{tc('cancel')}</Button>
                  </DialogClose>
                  <Button loading={markDelivered.isPending} onClick={handleMarkDelivered}>
                    {tc('confirm')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  <Trash2 className="mr-2 h-4 w-4" />
                  {tc('delete')}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('deleteShipmentConfirmTitle')}</DialogTitle>
                  <DialogDescription>{t('deleteShipmentConfirmDescription')}</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">{tc('cancel')}</Button>
                  </DialogClose>
                  <Button variant="destructive" loading={deleteShipment.isPending} onClick={handleDelete}>
                    {tc('delete')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">{t('carrier')}</p>
            <p className="text-sm">{shipment.carrier ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('packageCount')}</p>
            <p className="text-sm">{shipment.packageCount ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('weightKg')}</p>
            <p className="text-sm">{shipment.weightKg ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('dimensions')}</p>
            <p className="text-sm">{shipment.dimensions ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('shipDate')}</p>
            <p className="text-sm">{shipment.shipDate ? new Date(shipment.shipDate).toLocaleString() : '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('deliveryDate')}</p>
            <p className="text-sm">{shipment.deliveryDate ? new Date(shipment.deliveryDate).toLocaleString() : '—'}</p>
          </div>
          {shipment.comment && (
            <div className="col-span-full">
              <p className="text-xs text-muted-foreground">{t('comment')}</p>
              <p className="text-sm">{shipment.comment}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {shipment.items && shipment.items.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('finishedGoods')}</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Known simplification (documented in frontend/README.md): ShipmentItem only
                stores finishedGoodId, no serial join — raw id shown, same pattern as
                Inventory/BOM/Production/Procurement's id-without-name gap. */}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('finishedGoodId')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shipment.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-[320px] truncate" title={item.finishedGoodId}>
                      {item.finishedGoodId}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
