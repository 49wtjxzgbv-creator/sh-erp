'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingBlock } from '@/components/ui/loading-block';
import { supplierPortalApi } from '@/lib/supplier-portal/api';
import type { PurchaseOrder, PurchaseOrderStatus } from '@/lib/api-client/procurement';

const STATUS_VARIANT: Record<PurchaseOrderStatus, 'secondary' | 'warning' | 'success'> = {
  ORDERED: 'secondary',
  PARTIAL: 'warning',
  DELIVERED: 'success',
};

export default function SupplierPortalOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const t = useTranslations('supplierPortal');

  const [order, setOrder] = useState<PurchaseOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [deliveryDate, setDeliveryDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await supplierPortalApi.get<PurchaseOrder>(`supplier-portal/purchase-orders/${params.id}`);
    setOrder(res);
    setDeliveryDate(res.supplierConfirmedDeliveryDate ? res.supplierConfirmedDeliveryDate.slice(0, 10) : '');
    const seeded: Record<string, string> = {};
    for (const item of res.items ?? []) {
      seeded[item.id] = item.supplierConfirmedPrice != null ? String(item.supplierConfirmedPrice) : '';
    }
    setPrices(seeded);
    setLoading(false);
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading || !order) {
    return <LoadingBlock />;
  }

  async function handleSubmit() {
    setError(null);
    setSuccess(false);
    const items = (order!.items ?? [])
      .filter((item) => prices[item.id] && Number(prices[item.id]) >= 0)
      .map((item) => ({ id: item.id, confirmedPrice: Number(prices[item.id]) }));
    if (items.length === 0) {
      setError(t('invalidConfirmation'));
      return;
    }
    setSubmitting(true);
    try {
      await supplierPortalApi.post(`supplier-portal/purchase-orders/${order!.id}/confirm`, {
        confirmedDeliveryDate: deliveryDate || undefined,
        items,
      });
      setSuccess(true);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('confirmFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">{t('orderFrom', { date: new Date(order.orderDate).toLocaleDateString() })}</h2>
        <Badge variant={STATUS_VARIANT[order.status]}>{t(`status${order.status}`)}</Badge>
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">{t('expectedDeliveryDate')}</p>
            <p className="text-sm">{order.expectedDeliveryDate ? new Date(order.expectedDeliveryDate).toLocaleDateString() : '—'}</p>
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
                <TableHead>{t('qtyOrdered')}</TableHead>
                <TableHead className="w-40">{t('yourPrice')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(order.items ?? []).map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.articleSnapshot}</TableCell>
                  <TableCell className="max-w-[260px] truncate" title={item.productNameSnapshot}>{item.productNameSnapshot}</TableCell>
                  <TableCell>{item.qtyOrdered}</TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="any"
                      min={0}
                      value={prices[item.id] ?? ''}
                      onChange={(e) => setPrices((prev) => ({ ...prev, [item.id]: e.target.value }))}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('confirmDelivery')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="max-w-xs space-y-1.5">
            <Label htmlFor="deliveryDate">{t('yourDeliveryDate')}</Label>
            <Input id="deliveryDate" type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {success && <p className="text-sm text-success">{t('confirmSuccess')}</p>}
          <Button onClick={handleSubmit} loading={submitting}>
            {t('confirm')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
