'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  usePurchaseOrder,
  useReceivePurchaseOrder,
  useDeletePurchaseOrder,
  useSupplierLinkedProducts,
  useCreateDeliverySchedule,
  useAcceptDeliverySchedule,
  useRejectDeliverySchedule,
  usePurchaseOrderComments,
  useAddPurchaseOrderComment,
} from '@/lib/hooks/use-procurement';
import { useWarehouses } from '@/lib/hooks/use-inventory';
import { useFilesForEntities, useFilesForEntity } from '@/lib/hooks/use-files';
import { uploadFile, getFileDownloadUrl } from '@/lib/api-client/files';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { useFinanceSummary } from '@/lib/hooks/use-finance';
import { formatMoney } from '@/lib/finance-format';
import { formatEur } from '@/lib/utils';
import type { PurchaseOrderStatus, ReceivePurchaseOrderLineInput, PurchaseOrderItem, DeliveryScheduleStatus } from '@/lib/api-client/procurement';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { LoadingBlock } from '@/components/ui/loading-block';
import { Avatar } from '@/components/ui/avatar';
import { useHasPermission } from '@/lib/hooks/use-roles';
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

const SCHEDULE_STATUS_VARIANT: Record<DeliveryScheduleStatus, 'secondary' | 'warning' | 'success' | 'destructive'> = {
  PENDING: 'secondary',
  PROPOSED: 'warning',
  CONFIRMED: 'success',
  REJECTED: 'destructive',
  SUPERSEDED: 'secondary',
};

/**
 * Delivery Schedule (Phase 1, 2026-08-21) — additive per-item block, only
 * shown for items where staff have created one; an item with none keeps
 * showing exactly as before (no visual change). `item.currentDeliveryScheduleId`
 * marks the operative version; a PROPOSED version (supplier's counter-offer)
 * is shown separately with Accept/Reject, never merged into the current one.
 */
function DeliveryScheduleBlock({ orderId, item, canManage }: { orderId: string; item: PurchaseOrderItem; canManage: boolean }) {
  const t = useTranslations('procurement');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const createSchedule = useCreateDeliverySchedule(orderId);
  const acceptSchedule = useAcceptDeliverySchedule(orderId);
  const rejectSchedule = useRejectDeliverySchedule(orderId);

  const [creating, setCreating] = useState(false);
  const [lines, setLines] = useState<{ date: string; qty: string }[]>([{ date: '', qty: '' }]);
  const [error, setError] = useState<string | null>(null);

  const schedules = item.deliverySchedules ?? [];
  const current = schedules.find((s) => s.id === item.currentDeliveryScheduleId);
  const proposed = schedules.find((s) => s.status === 'PROPOSED');
  const history = schedules.filter((s) => s.id !== current?.id && s.id !== proposed?.id);

  async function handleCreate() {
    setError(null);
    const parsed = lines
      .filter((l) => l.date && l.qty)
      .map((l) => ({ date: l.date, qty: Number(l.qty) }));
    if (parsed.length === 0) {
      setError(t('invalidRow'));
      return;
    }
    try {
      await createSchedule.mutateAsync({ itemId: item.id, lines: parsed });
      setCreating(false);
      setLines([{ date: '', qty: '' }]);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleAccept(scheduleId: string) {
    setError(null);
    try {
      await acceptSchedule.mutateAsync(scheduleId);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleReject(scheduleId: string) {
    setError(null);
    try {
      await rejectSchedule.mutateAsync(scheduleId);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  if (!current && !canManage) return null;

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <p className="text-xs font-medium text-muted-foreground">{t('deliverySchedule')}</p>

      {current && (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={SCHEDULE_STATUS_VARIANT[current.status]}>{t(`scheduleStatus${current.status}`)}</Badge>
            <span className="text-muted-foreground">
              {t('scheduled')}: {current.lines.reduce((s, l) => s + Number(l.qty), 0)}
              {current.status === 'CONFIRMED' && ` · ${t('confirmed')}: ${current.lines.reduce((s, l) => s + Number(l.qty), 0)}`}
            </span>
          </div>
          <ul className="space-y-0.5 text-sm">
            {current.lines.map((l) => (
              <li key={l.id}>
                {new Date(l.date).toLocaleDateString()} — {l.qty}
              </li>
            ))}
          </ul>
        </div>
      )}

      {proposed && (
        <div className="space-y-1 rounded-md border border-warning/40 bg-warning/5 p-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge variant="warning">{t('supplierProposed')}</Badge>
            {canManage && (
              <div className="flex gap-2">
                <Button size="sm" loading={acceptSchedule.isPending} onClick={() => handleAccept(proposed.id)}>
                  {t('acceptProposal')}
                </Button>
                <Button size="sm" variant="outline" loading={rejectSchedule.isPending} onClick={() => handleReject(proposed.id)}>
                  {t('rejectProposal')}
                </Button>
              </div>
            )}
          </div>
          <ul className="space-y-0.5 text-sm">
            {proposed.lines.map((l) => (
              <li key={l.id}>
                {new Date(l.date).toLocaleDateString()} — {l.qty}
              </li>
            ))}
          </ul>
        </div>
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

      {!current && canManage && (
        <div className="space-y-2">
          {!creating ? (
            <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
              {t('createSchedule')}
            </Button>
          ) : (
            <div className="space-y-2">
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
                <Button size="sm" loading={createSchedule.isPending} onClick={handleCreate}>
                  {tc('save')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
                  {tc('cancel')}
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

/**
 * Finance module (2026-08-24) — compact summary only, deliberately not the
 * full Finance UI (point 14 of the confirmed design: don't duplicate
 * /finance/[purchaseOrderId] here). Hidden entirely for a user without
 * `finance:read` (the module defaults to admin-only, same sensitivity as
 * `reports:valuation`).
 */
function FinanceSummaryWidget({ orderId }: { orderId: string }) {
  const t = useTranslations('finance');
  const canReadFinance = useHasPermission('finance:read');
  const { data: summary } = useFinanceSummary(canReadFinance ? orderId : undefined);
  if (!canReadFinance || !summary) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{t('financeSummary')}</CardTitle>
        <Link href={`/finance/${orderId}`} className="text-sm text-primary hover:underline">
          {t('viewInFinance')}
        </Link>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4 pt-0 sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">{t('actualCost')}</p>
          <p className="text-sm font-medium">{formatMoney(summary.actualCost, summary.primaryCurrency)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t('paid')}</p>
          <p className="text-sm font-medium">{formatMoney(summary.paid, summary.primaryCurrency)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t('unpaidPerDocuments')}</p>
          <p className="text-sm font-medium">{formatMoney(summary.unpaidPerDocuments, summary.primaryCurrency)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t('documentCount')}</p>
          <p className="text-sm font-medium">{summary.documentCount}</p>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Phase 2 — documents (invoices, packing lists) attached to this order,
 * staff- and supplier-uploaded alike. Reuses the existing generic files API
 * (entityType='PurchaseOrder', domain='PURCHASE_INVOICE') — no new backend
 * endpoint needed on the staff side.
 *
 * LEGACY, kept as-is (2026-08-24 pre-production audit, point 7): a plain
 * flat file list, no type/number/date/amount/counterparty/payment
 * structure. The Finance module (FinanceSummaryWidget above, full UI at
 * /finance/[id]) is now the CANONICAL way to record a PO's financial
 * documents. Nothing here migrates or duplicates into Finance automatically
 * — a file uploaded in one panel never appears in the other; they are two
 * independent upload actions the user chooses between.
 */
function PurchaseOrderDocumentsPanel({ orderId, canManage }: { orderId: string; canManage: boolean }) {
  const t = useTranslations('procurement');
  const tc = useTranslations('common');
  const tf = useTranslations('finance');
  const { data: files, refetch } = useFilesForEntity('PurchaseOrder', orderId, 'PURCHASE_INVOICE');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await uploadFile(file, { domain: 'PURCHASE_INVOICE', entityType: 'PurchaseOrder', entityId: orderId });
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : tc('error'));
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(fileAssetId: string) {
    const { downloadUrl } = await getFileDownloadUrl(fileAssetId);
    window.open(downloadUrl, '_blank', 'noopener,noreferrer');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('documents')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {tf('title')}:{' '}
          <Link href={`/finance/${orderId}`} className="text-primary hover:underline">
            {tf('viewInFinance')}
          </Link>
        </p>
        {(files ?? []).length === 0 && <p className="text-sm text-muted-foreground">{t('noDocuments')}</p>}
        <ul className="space-y-1">
          {(files ?? []).map((f) => (
            <li key={f.id}>
              <button type="button" className="text-sm text-primary hover:underline" onClick={() => handleDownload(f.id)}>
                {f.originalName}
              </button>
            </li>
          ))}
        </ul>
        {canManage && (
          <div className="space-y-1.5">
            <input type="file" onChange={handleFileSelected} disabled={uploading} className="text-sm" />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Phase 2 — flat discussion thread for this order, shared with the connected supplier. */
function PurchaseOrderCommentsPanel({ orderId }: { orderId: string }) {
  const t = useTranslations('procurement');
  const { data: comments } = usePurchaseOrderComments(orderId);
  const addComment = useAddPurchaseOrderComment(orderId);
  const [body, setBody] = useState('');

  async function handleSubmit() {
    if (!body.trim()) return;
    await addComment.mutateAsync(body.trim());
    setBody('');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('comments')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {(comments ?? []).length === 0 && <p className="text-sm text-muted-foreground">{t('noComments')}</p>}
        <ul className="space-y-2">
          {(comments ?? []).map((c) => (
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
          <Button size="sm" loading={addComment.isPending} onClick={handleSubmit}>
            {t('postComment')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function PurchaseOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('procurement');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();

  const { data: order, isLoading, isError, error: loadError } = usePurchaseOrder(params.id);
  const { data: warehouses } = useWarehouses();
  const receive = useReceivePurchaseOrder(params.id);
  const deleteOrder = useDeletePurchaseOrder();
  const canManage = useHasPermission('purchase-orders:manage');
  const canDelete = useHasPermission('purchase-orders:delete');
  const canReadSuppliers = useHasPermission('suppliers:read');

  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});
  const [receivePrice, setReceivePrice] = useState<Record<string, string>>({});
  const [warehouseId, setWarehouseId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const productIds = useMemo(
    () => Array.from(new Set((order?.items ?? []).filter((i) => i.productId).map((i) => i.productId as string))),
    [order?.items],
  );
  const { data: photosByProduct } = useFilesForEntities('Product', productIds, 'PRODUCT_PHOTO');
  const { data: supplierProducts } = useSupplierLinkedProducts(canReadSuppliers ? order?.supplierId ?? undefined : undefined);
  const supplierPriceByProduct = useMemo(
    () => new Map((supplierProducts ?? []).map((sp) => [sp.productId, sp.price])),
    [supplierProducts],
  );

  if (isError) {
    return <p className="text-sm text-destructive">{apiErrorMessage(loadError, t('orderNotFound'))}</p>;
  }

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
        {canDelete && (
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
        )}
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
                <TableHead className="w-14">{t('photo')}</TableHead>
                <TableHead>{t('article')}</TableHead>
                <TableHead>{t('productName')}</TableHead>
                <TableHead numeric>{t('qtyOrdered')}</TableHead>
                <TableHead numeric>{t('qtyReceived')}</TableHead>
                <TableHead numeric>{t('supplierPrice')}</TableHead>
                <TableHead numeric>{t('expectedPrice')}</TableHead>
                <TableHead numeric>{t('actualPrice')}</TableHead>
                <TableHead numeric>{t('supplierConfirmedPrice')}</TableHead>
                {!isDelivered && canManage && <TableHead className="w-28">{t('receiveNow')}</TableHead>}
                {!isDelivered && canManage && <TableHead className="w-28">{t('actualPrice')}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(order.items ?? []).map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Avatar src={item.productId ? photosByProduct?.[item.productId]?.[0]?.downloadUrl : undefined} size="sm" />
                  </TableCell>
                  <TableCell>{item.articleSnapshot}</TableCell>
                  <TableCell className="max-w-[220px] truncate" title={item.productNameSnapshot}>{item.productNameSnapshot}</TableCell>
                  <TableCell numeric>{item.qtyOrdered}</TableCell>
                  <TableCell numeric>{item.qtyReceived}</TableCell>
                  <TableCell numeric>
                    {(() => {
                      const price = item.productId ? supplierPriceByProduct.get(item.productId) : undefined;
                      return price != null ? formatEur(Number(price)) : '—';
                    })()}
                  </TableCell>
                  <TableCell numeric>{item.expectedPrice != null ? formatEur(Number(item.expectedPrice)) : '—'}</TableCell>
                  <TableCell numeric>{item.actualPrice != null ? formatEur(Number(item.actualPrice)) : '—'}</TableCell>
                  <TableCell numeric>{item.supplierConfirmedPrice != null ? formatEur(Number(item.supplierConfirmedPrice)) : '—'}</TableCell>
                  {!isDelivered && canManage && (
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
                  {!isDelivered && canManage && (
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('deliverySchedule')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(order.items ?? []).map((item) => (
            <div key={item.id}>
              <p className="text-sm font-medium">
                {item.articleSnapshot} — <span className="text-muted-foreground">{item.productNameSnapshot}</span>
              </p>
              <DeliveryScheduleBlock orderId={order.id} item={item} canManage={canManage} />
            </div>
          ))}
        </CardContent>
      </Card>

      <FinanceSummaryWidget orderId={order.id} />
      <PurchaseOrderDocumentsPanel orderId={order.id} canManage={canManage} />
      <PurchaseOrderCommentsPanel orderId={order.id} />

      {!isDelivered && canManage && (
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
