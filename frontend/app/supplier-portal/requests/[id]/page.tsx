'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Avatar } from '@/components/ui/avatar';
import { FilePreviewButton } from '@/components/domain/files/file-preview-button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingBlock } from '@/components/ui/loading-block';
import { supplierPortalApi } from '@/lib/supplier-portal/api';
import { useApiErrorMessage } from '@/lib/api-error-message';
import type { PurchaseRequest, PurchaseRequestStatus } from '@/lib/api-client/procurement';

const STATUS_VARIANT: Record<PurchaseRequestStatus, 'secondary' | 'warning' | 'success'> = {
  DRAFT: 'secondary',
  SENT: 'warning',
  CONVERTED: 'success',
  CANCELLED: 'secondary',
};

/**
 * Supplier-portal exposure for PurchaseRequest ("заявка на прорахунок",
 * 2026-11-02) — same card-stacking shape as the PurchaseOrder detail page
 * (`../../[id]/page.tsx`), minus documents/comments/delivery-schedule,
 * which are PO-specific concepts an RFQ doesn't have. A separate
 * `/requests/:id` path segment avoids colliding with that page's own
 * `/[id]` id-namespace — a request id and an order id are different
 * entities that could otherwise collide at the same URL shape.
 */
export default function SupplierPortalRequestDetailPage() {
  const params = useParams<{ id: string }>();
  const t = useTranslations('supplierPortal');
  const apiErrorMessage = useApiErrorMessage();

  const [request, setRequest] = useState<PurchaseRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [prices, setPrices] = useState<Record<string, string>>({});
  /** "в наступних заявках автоматично підтягуватися якщо в них є вже товари які він оцінив раніше" (2026-11-09) — items pre-filled from catalogPrice rather than an explicit quote already on THIS заявка, so the UI can hint it's a suggestion, not yet confirmed. */
  const [prefilledFromCatalog, setPrefilledFromCatalog] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await supplierPortalApi.get<PurchaseRequest>(`supplier-portal/purchase-requests/${params.id}`);
      setRequest(res);
      const seeded: Record<string, string> = {};
      const fromCatalog: Record<string, boolean> = {};
      for (const item of res.items ?? []) {
        if (item.supplierQuotedPrice != null) {
          seeded[item.id] = String(item.supplierQuotedPrice);
        } else if (item.catalogPrice != null) {
          seeded[item.id] = String(item.catalogPrice);
          fromCatalog[item.id] = true;
        } else {
          seeded[item.id] = '';
        }
      }
      setPrices(seeded);
      setPrefilledFromCatalog(fromCatalog);
    } catch (err) {
      setLoadError(err);
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loadError) {
    return <p className="text-sm text-destructive">{apiErrorMessage(loadError, t('requestNotFound'))}</p>;
  }

  if (loading || !request) {
    return <LoadingBlock />;
  }

  async function handleSubmit() {
    setError(null);
    setSuccess(false);
    // ".replace(',', '.')" — the price field is a plain text input (not
    // type="number") so the browser never normalizes a typed "1234,56"
    // on its own; Ukrainian users type a comma decimal point routinely.
    const items = (request!.items ?? [])
      .filter((item) => prices[item.id] && Number(prices[item.id].replace(',', '.')) >= 0)
      .map((item) => ({ id: item.id, quotedPrice: Number(prices[item.id].replace(',', '.')) }));
    if (items.length === 0) {
      setError(t('invalidQuote'));
      return;
    }
    setSubmitting(true);
    try {
      await supplierPortalApi.post(`supplier-portal/purchase-requests/${request!.id}/quote`, { items });
      setSuccess(true);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, t('quoteFailed')));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">{request.number}</h2>
        <Badge variant={STATUS_VARIANT[request.status]}>{t(`prStatus${request.status}`)}</Badge>
      </div>

      {request.comment && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">{t('comment')}</p>
            <p className="text-sm">{request.comment}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('items')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12" />
                <TableHead>{t('article')}</TableHead>
                <TableHead>{t('productName')}</TableHead>
                <TableHead>{t('qty')}</TableHead>
                <TableHead className="w-24">{t('yourPrice')}</TableHead>
                <TableHead>{t('attachFiles')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(request.items ?? []).map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Avatar src={item.photoUrl} size="sm" />
                  </TableCell>
                  <TableCell>{item.articleSnapshot}</TableCell>
                  <TableCell className="max-w-[260px] truncate" title={item.productNameSnapshot}>{item.productNameSnapshot}</TableCell>
                  <TableCell>{item.qty}</TableCell>
                  <TableCell>
                    {/* "нормально не видно цін якщо там цифра більше чим 2 символи" (2026-11-17) — the spinner removal alone wasn't enough: a width:100% input has no intrinsic content size of its own for the table's auto-layout algorithm to size the COLUMN by, so the `<th>`'s own width hint got silently ignored and the rendered box collapsed to ~59px (confirmed live — verified via computed styles on the actual production page). `min-w-[calc(5ch+1.5rem)]` gives the input a real minimum box the layout algorithm has to honor — the +1.5rem accounts for this box-sizing: border-box input's own 0.75rem horizontal padding on each side, which a bare 5ch budget ate into instead of leaving room for the digits themselves (confirmed live again: 5ch alone rendered at the same ~59px as the original bug). */}
                    <Input
                      inputMode="decimal"
                      className="min-w-[calc(5ch+1.5rem)]"
                      disabled={request.status !== 'SENT'}
                      value={prices[item.id] ?? ''}
                      onChange={(e) => {
                        setPrices((prev) => ({ ...prev, [item.id]: e.target.value }));
                        setPrefilledFromCatalog((prev) => ({ ...prev, [item.id]: false }));
                      }}
                    />
                    {prefilledFromCatalog[item.id] && <p className="mt-1 text-xs text-muted-foreground">{t('yourPriceFromCatalogHint')}</p>}
                  </TableCell>
                  <TableCell>
                    {item.attachedFiles && item.attachedFiles.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        {item.attachedFiles.map((file) => (
                          <FilePreviewButton key={file.id} file={file} />
                        ))}
                      </div>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {request.status === 'SENT' && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            {error && <p className="text-sm text-destructive">{error}</p>}
            {success && <p className="text-sm text-success">{t('quoteSuccess')}</p>}
            <Button onClick={handleSubmit} loading={submitting}>
              {t('submitQuote')}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
