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
import type { PurchaseOrder, PurchaseOrderStatus, PurchaseOrderItem, DeliveryScheduleStatus, PurchaseOrderComment } from '@/lib/api-client/procurement';
import type { FileAsset } from '@/lib/api-client/files';

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
  const history = schedules.filter((s) => s.id !== current?.id && s.id !== proposed?.id);

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

      {history.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">{t('scheduleHistory')}</summary>
          <ul className="mt-1 space-y-1">
            {history.map((s) => (
              <li key={s.id}>
                v{s.versionNumber} — <Badge variant={SCHEDULE_STATUS_VARIANT[s.status]}>{t(`scheduleStatus${s.status}`)}</Badge>{' '}
                {s.lines.map((l) => `${new Date(l.date).toLocaleDateString()}: ${l.qty}`).join(', ')}
              </li>
            ))}
          </ul>
        </details>
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

/** Phase 2 — documents (invoices, packing lists) attached to this order. Own presigned-upload flow (supplier-portal has its own auth surface, not lib/api-client/files.ts's staff-permission-gated endpoints) — same 3-step presign→PUT→confirm shape either way. */
function SupplierPortalDocumentsPanel({ orderId }: { orderId: string }) {
  const t = useTranslations('supplierPortal');
  const [files, setFiles] = useState<FileAsset[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await supplierPortalApi.get<FileAsset[]>(`supplier-portal/purchase-orders/${orderId}/files`);
    setFiles(res);
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const presigned = await supplierPortalApi.post<{ fileAssetId: string; uploadUrl: string }>(
        `supplier-portal/purchase-orders/${orderId}/files/presigned-upload`,
        { originalName: file.name, mimeType: file.type || 'application/octet-stream', sizeBytes: file.size },
      );
      const putRes = await fetch(presigned.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!putRes.ok) throw new Error(`Upload to storage failed (${putRes.status}).`);
      await supplierPortalApi.post(`supplier-portal/purchase-orders/${orderId}/files/${presigned.fileAssetId}/confirm`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('scheduleActionFailed'));
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(fileAssetId: string) {
    const { downloadUrl } = await supplierPortalApi.get<{ downloadUrl: string }>(`supplier-portal/purchase-orders/${orderId}/files/${fileAssetId}/download-url`);
    window.open(downloadUrl, '_blank', 'noopener,noreferrer');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('documents')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {files.length === 0 && <p className="text-sm text-muted-foreground">{t('noDocuments')}</p>}
        <ul className="space-y-1">
          {files.map((f) => (
            <li key={f.id}>
              <button type="button" className="text-sm text-primary hover:underline" onClick={() => handleDownload(f.id)}>
                {f.originalName}
              </button>
            </li>
          ))}
        </ul>
        <div className="space-y-1.5">
          <input type="file" onChange={handleFileSelected} disabled={uploading} className="text-sm" />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

/** Phase 2 — flat discussion thread for this order, shared with the manufacturer. */
function SupplierPortalCommentsPanel({ orderId }: { orderId: string }) {
  const t = useTranslations('supplierPortal');
  const [comments, setComments] = useState<PurchaseOrderComment[]>([]);
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const res = await supplierPortalApi.get<PurchaseOrderComment[]>(`supplier-portal/purchase-orders/${orderId}/comments`);
    setComments(res);
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit() {
    if (!body.trim()) return;
    setSubmitting(true);
    try {
      await supplierPortalApi.post(`supplier-portal/purchase-orders/${orderId}/comments`, { body: body.trim() });
      setBody('');
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('comments')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {comments.length === 0 && <p className="text-sm text-muted-foreground">{t('noComments')}</p>}
        <ul className="space-y-2">
          {comments.map((c) => (
            <li key={c.id} className="rounded-md border border-border p-2 text-sm">
              <p className="mb-1 text-xs text-muted-foreground">
                {c.authorType === 'STAFF' ? t('commentFromStaff') : t('commentFromSupplier')} · {new Date(c.createdAt).toLocaleString()}
              </p>
              <p>{c.body}</p>
            </li>
          ))}
        </ul>
        <div className="space-y-1.5">
          <textarea
            className="w-full rounded-md border border-input bg-background p-2 text-sm"
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t('commentPlaceholder')}
          />
          <Button size="sm" loading={submitting} onClick={handleSubmit}>
            {t('postComment')}
          </Button>
        </div>
      </CardContent>
    </Card>
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
                <TableHead>{t('qtyReceived')}</TableHead>
                <TableHead className="w-40">{t('yourPrice')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(order.items ?? []).map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.articleSnapshot}</TableCell>
                  <TableCell className="max-w-[260px] truncate" title={item.productNameSnapshot}>{item.productNameSnapshot}</TableCell>
                  <TableCell>{item.qtyOrdered}</TableCell>
                  <TableCell>{item.qtyReceived}</TableCell>
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

      <SupplierPortalDocumentsPanel orderId={order.id} />
      <SupplierPortalCommentsPanel orderId={order.id} />

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
