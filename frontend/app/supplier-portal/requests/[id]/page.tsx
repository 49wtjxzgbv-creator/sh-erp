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
      for (const item of res.items ?? []) {
        seeded[item.id] = item.supplierQuotedPrice != null ? String(item.supplierQuotedPrice) : '';
      }
      setPrices(seeded);
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
    const items = (request!.items ?? [])
      .filter((item) => prices[item.id] && Number(prices[item.id]) >= 0)
      .map((item) => ({ id: item.id, quotedPrice: Number(prices[item.id]) }));
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
                <TableHead className="w-40">{t('yourPrice')}</TableHead>
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
                    <Input
                      type="number"
                      step="any"
                      min={0}
                      disabled={request.status !== 'SENT'}
                      value={prices[item.id] ?? ''}
                      onChange={(e) => setPrices((prev) => ({ ...prev, [item.id]: e.target.value }))}
                    />
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
