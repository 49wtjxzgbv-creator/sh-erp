'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { usePurchaseOrder, useReceivePurchaseOrder, useDeletePurchaseOrder } from '@/lib/hooks/use-procurement';
import { useWarehouses } from '@/lib/hooks/use-inventory';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { formatEur } from '@/lib/utils';
import type { PurchaseOrderStatus, ReceivePurchaseOrderLineInput } from '@/lib/api-client/procurement';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
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

const STATUS_VARIANT: Record<PurchaseOrderStatus, 'secondary' | 'warning' | 'success'> = {
  ORDERED: 'secondary',
  PARTIAL: 'warning',
  DELIVERED: 'success',
};

export default function PurchaseOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('procurement');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();

  const { data: order, isLoading } = usePurchaseOrder(params.id);
  const { data: warehouses } = useWarehouses();
  const receive = useReceivePurchaseOrder(params.id);
  const deleteOrder = useDeletePurchaseOrder();

  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});
  const [receivePrice, setReceivePrice] = useState<Record<string, string>>({});
  const [warehouseId, setWarehouseId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (isLoading || !order) {
    return <LoadingBlock />;
  }

  async function handleReceive() {
    setError(null);
    setSuccess(false);
    const lines: ReceivePurchaseOrderLineInput[] = [];
    for (const item of order!.items ?? []) {
      const qtyStr = receiveQty[item.id];
      const qty = Number(qtyStr);
      if (qtyStr && qty > 0) {
        const priceStr = receivePrice[item.id];
        lines.push({
          purchaseOrderItemId: item.id,
          qtyReceived: qty,
          actualPrice: priceStr ? Number(priceStr) : undefined,
        });
      }
    }
    if (lines.length === 0) {
      setError(t('invalidRow'));
      return;
    }
    try {
      await receive.mutateAsync({ warehouseId, lines });
      setReceiveQty({});
      setReceivePrice({});
      setSuccess(true);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleDelete() {
    setError(null);
    try {
      await deleteOrder.mutateAsync(params.id);
      router.replace('/procurement');
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  const isDelivered = order.status === 'DELIVERED';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">{order.supplierNameSnapshot}</h2>
          <Badge variant={STATUS_VARIANT[order.status]}>{t(`poStatus${order.status}`)}</Badge>
        </div>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="destructive" size="sm">
              {t('deleteOrderPermanently')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('deleteOrderConfirmTitle')}</DialogTitle>
              <DialogDescription>{t('deleteOrderConfirmDescription')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">{tc('cancel')}</Button>
              </DialogClose>
              <Button variant="destructive" loading={deleteOrder.isPending} onClick={handleDelete}>
                {tc('delete')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">{t('orderDate')}</p>
            <p className="text-sm">{new Date(order.orderDate).toLocaleDateString()}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('expectedDeliveryDate')}</p>
            <p className="text-sm">{order.expectedDeliveryDate ? new Date(order.expectedDeliveryDate).toLocaleDateString() : '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('supplierConfirmedDeliveryDate')}</p>
            <p className="text-sm">
              {order.supplierConfirmedDeliveryDate ? new Date(order.supplierConfirmedDeliveryDate).toLocaleDateString() : '—'}
            </p>
          </div>
          {order.comment && (
            <div className="col-span-full">
              <p className="text-xs text-muted-foreground">{t('comment')}</p>
              <p className="text-sm">{order.comment}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('items')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('article')}</TableHead>
                <TableHead>{t('productName')}</TableHead>
                <TableHead numeric>{t('qtyOrdered')}</TableHead>
                <TableHead numeric>{t('qtyReceived')}</TableHead>
                <TableHead numeric>{t('expectedPrice')}</TableHead>
                <TableHead numeric>{t('actualPrice')}</TableHead>
                <TableHead numeric>{t('supplierConfirmedPrice')}</TableHead>
                {!isDelivered && <TableHead className="w-28">{t('receiveNow')}</TableHead>}
                {!isDelivered && <TableHead className="w-28">{t('actualPrice')}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(order.items ?? []).map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.articleSnapshot}</TableCell>
                  <TableCell className="max-w-[220px] truncate" title={item.productNameSnapshot}>{item.productNameSnapshot}</TableCell>
                  <TableCell numeric>{item.qtyOrdered}</TableCell>
                  <TableCell numeric>{item.qtyReceived}</TableCell>
                  <TableCell numeric>{item.expectedPrice != null ? formatEur(Number(item.expectedPrice)) : '—'}</TableCell>
                  <TableCell numeric>{item.actualPrice != null ? formatEur(Number(item.actualPrice)) : '—'}</TableCell>
                  <TableCell numeric>{item.supplierConfirmedPrice != null ? formatEur(Number(item.supplierConfirmedPrice)) : '—'}</TableCell>
                  {!isDelivered && (
                    <TableCell>
                      <Input
                        type="number"
                        step="any"
                        min={0}
                        value={receiveQty[item.id] ?? ''}
                        onChange={(e) => setReceiveQty((prev) => ({ ...prev, [item.id]: e.target.value }))}
                      />
                    </TableCell>
                  )}
                  {!isDelivered && (
                    <TableCell>
                      <Input
                        type="number"
                        step="any"
                        min={0}
                        value={receivePrice[item.id] ?? ''}
                        onChange={(e) => setReceivePrice((prev) => ({ ...prev, [item.id]: e.target.value }))}
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {!isDelivered && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('receiveDelivery')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t('warehouseOptional')}</Label>
              <Select value={warehouseId ?? '__default'} onValueChange={(v) => setWarehouseId(v === '__default' ? undefined : v)}>
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default">{t('defaultWarehouse')}</SelectItem>
                  {warehouses?.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {success && <p className="text-sm text-success">{t('receiveSuccess')}</p>}
            <Button onClick={handleReceive} loading={receive.isPending}>
              {t('receiveDelivery')}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
