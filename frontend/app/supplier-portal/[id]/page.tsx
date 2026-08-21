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
import type { PurchaseOrder, PurchaseOrderStatus, PurchaseOrderItem, DeliveryScheduleStatus } from '@/lib/api-client/procurement';

const STATUS_VARIANT: Record<PurchaseOrderStatus, 'secondary' | 'warning' | 'success'> = {
  ORDERED: 'secondary',
  PARTIAL: 'warning',
  DELIVERED: 'success',
};

const SCHEDULE_STATUS_VARIANT: Record<DeliveryScheduleStatus, 'secondary' | 'warning' | 'success' | 'destructive'> = {
  PENDING: 'secondary',
  PROPOSED: 'warning',
  CONFIRMED: 'success',
  REJECTED: 'destructive',
  SUPERSEDED: 'secondary',
};

/**
 * Delivery Schedule (Phase 1, 2026-08-21) — additive per-item block, only
 * shown for items where the manufacturer created one. `onChanged` reloads
 * the whole order from the parent, same pattern the price/date confirm
 * form already uses.
 */
function SupplierDeliveryScheduleBlock({ orderId, item, onChanged }: { orderId: string; item: PurchaseOrderItem; onChanged: () => Promise<void> }) {
  const t = useTranslations('supplierPortal');
  const [proposing, setProposing] = useState(false);
  const [lines, setLines] = useState<{ date: string; qty: string }[]>([{ date: '', qty: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const schedules = item.deliverySchedules ?? [];
  const current = schedules.find((s) => s.id === item.currentDeliveryScheduleId);
  const proposed = schedules.find((s) => s.status === 'PROPOSED');

  if (!current) return null;

  const currentTotal = current.lines.reduce((s, l) => s + Number(l.qty), 0);

  async function handleConfirm() {
    setError(null);
    setBusy(true);
    try {
      await supplierPortalApi.post(`supplier-portal/purchase-orders/${orderId}/delivery-schedule/${current!.id}/confirm`);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('scheduleActionFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function handlePropose() {
    setError(null);
    const parsed = lines.filter((l) => l.date && l.qty).map((l) => ({ date: l.date, qty: Number(l.qty) }));
    if (parsed.length === 0) {
      setError(t('invalidConfirmation'));
      return;
    }
    setBusy(true);
    try {
      await supplierPortalApi.post(`supplier-portal/purchase-orders/${orderId}/delivery-schedule/${current!.id}/propose`, { lines: parsed });
      setProposing(false);
      setLines([{ date: '', qty: '' }]);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('scheduleActionFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-2 border-t border-border pt-2">
      <p className="text-xs font-medium text-muted-foreground">{t('deliverySchedule')}</p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={SCHEDULE_STATUS_VARIANT[current.status]}>{t(`scheduleStatus${current.status}`)}</Badge>
      </div>
      <ul className="space-y-0.5 text-sm">
        {current.lines.map((l) => (
          <li key={l.id}>
            {new Date(l.date).toLocaleDateString()} — {l.qty}
          </li>
        ))}
      </ul>

      {proposed && (
        <p className="text-sm text-muted-foreground">{t('proposalAwaitingDecision')}</p>
      )}

      {current.status === 'PENDING' && !proposed && (
        <div className="space-y-2">
          {!proposing ? (
            <div className="flex gap-2">
              <Button size="sm" loading={busy} onClick={handleConfirm}>
                {t('confirm')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setProposing(true)}>
                {t('proposeChanges')}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{t('proposeChangesHint', { total: currentTotal })}</p>
              {lines.map((line, idx) => (
                <div key={idx} className="flex gap-2">
                  <Input
                    type="date"
                    value={line.date}
                    onChange={(e) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, date: e.target.value } : l)))}
                  />
                  <Input
                    type="number"
                    step="any"
                    min={0}
                    placeholder={t('scheduleQty')}
                    value={line.qty}
                    onChange={(e) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, qty: e.target.value } : l)))}
                  />
                </div>
              ))}
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setLines((prev) => [...prev, { date: '', qty: '' }])}>
                  {t('addLine')}
                </Button>
                <Button size="sm" loading={busy} onClick={handlePropose}>
                  {t('submitProposal')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setProposing(false)}>
                  {t('cancel')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

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

      {(order.items ?? []).some((item) => item.currentDeliveryScheduleId) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('deliverySchedule')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(order.items ?? [])
              .filter((item) => item.currentDeliveryScheduleId)
              .map((item) => (
                <div key={item.id}>
                  <p className="text-sm font-medium">
                    {item.articleSnapshot} — <span className="text-muted-foreground">{item.productNameSnapshot}</span>
                  </p>
                  <SupplierDeliveryScheduleBlock orderId={order.id} item={item} onChanged={load} />
                </div>
              ))}
          </CardContent>
        </Card>
      )}

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
