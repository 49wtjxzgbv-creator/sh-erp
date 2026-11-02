'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supplierPortalApi } from '@/lib/supplier-portal/api';
import type { PurchaseOrderStatus, PurchaseRequestStatus } from '@/lib/api-client/procurement';

interface PortalPurchaseOrderRow {
  id: string;
  orderDate: string;
  status: PurchaseOrderStatus;
  expectedDeliveryDate: string | null;
  supplierConfirmedAt: string | null;
  items: { id: string }[];
}

interface PortalPurchaseRequestRow {
  id: string;
  number: string;
  createdAt: string;
  status: PurchaseRequestStatus;
  supplierRespondedAt: string | null;
  items: { id: string }[];
}

const STATUS_VARIANT: Record<PurchaseOrderStatus, 'secondary' | 'warning' | 'success'> = {
  ORDERED: 'secondary',
  PARTIAL: 'warning',
  DELIVERED: 'success',
};

const REQUEST_STATUS_VARIANT: Record<PurchaseRequestStatus, 'secondary' | 'warning' | 'success'> = {
  DRAFT: 'secondary',
  SENT: 'warning',
  CONVERTED: 'success',
  CANCELLED: 'secondary',
};

export default function SupplierPortalOrdersPage() {
  const t = useTranslations('supplierPortal');
  const router = useRouter();
  const [orders, setOrders] = useState<PortalPurchaseOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<PortalPurchaseRequestRow[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Deliberately swallows the error rather than surfacing it — the one
      // expected case (2026-08-21 P2) is a supplier who logged in with only
      // a PENDING connection (self-registered, found by a company, not yet
      // accepted): SupplierPortalScopeInterceptor 404s this endpoint until
      // acceptance, which is indistinguishable here from "no orders yet" —
      // the same empty state already covers it correctly.
      const res = await supplierPortalApi.get<{ items: PortalPurchaseOrderRow[] }>('supplier-portal/purchase-orders');
      setOrders(res.items);
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRequests = useCallback(async () => {
    setRequestsLoading(true);
    try {
      // Same swallow-on-error convention as orders' load() above.
      const res = await supplierPortalApi.get<{ items: PortalPurchaseRequestRow[] }>('supplier-portal/purchase-requests');
      setRequests(res.items);
    } catch {
      setRequests([]);
    } finally {
      setRequestsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    loadRequests();
  }, [load, loadRequests]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t('yourPurchaseOrders')}</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('yourPurchaseOrders')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('orderDate')}</TableHead>
                <TableHead>{t('status')}</TableHead>
                <TableHead>{t('expectedDeliveryDate')}</TableHead>
                <TableHead>{t('lineCount')}</TableHead>
                <TableHead>{t('confirmed')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    {t('loading')}
                  </TableCell>
                </TableRow>
              ) : orders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    {t('noOrders')}
                  </TableCell>
                </TableRow>
              ) : (
                orders.map((o) => (
                  <TableRow key={o.id} className="cursor-pointer" onClick={() => router.push(`/supplier-portal/${o.id}`)}>
                    <TableCell>{new Date(o.orderDate).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[o.status]}>{t(`status${o.status}`)}</Badge>
                    </TableCell>
                    <TableCell>{o.expectedDeliveryDate ? new Date(o.expectedDeliveryDate).toLocaleDateString() : '—'}</TableCell>
                    <TableCell>{o.items.length}</TableCell>
                    <TableCell>
                      {o.supplierConfirmedAt ? (
                        <Badge variant="success">{t('yes')}</Badge>
                      ) : (
                        <Badge variant="secondary">{t('no')}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('yourPurchaseRequests')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('requestNumber')}</TableHead>
                <TableHead>{t('orderDate')}</TableHead>
                <TableHead>{t('status')}</TableHead>
                <TableHead>{t('lineCount')}</TableHead>
                <TableHead>{t('quoted')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requestsLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    {t('loading')}
                  </TableCell>
                </TableRow>
              ) : requests.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    {t('noRequests')}
                  </TableCell>
                </TableRow>
              ) : (
                requests.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => router.push(`/supplier-portal/requests/${r.id}`)}>
                    <TableCell>{r.number}</TableCell>
                    <TableCell>{new Date(r.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Badge variant={REQUEST_STATUS_VARIANT[r.status]}>{t(`prStatus${r.status}`)}</Badge>
                    </TableCell>
                    <TableCell>{r.items.length}</TableCell>
                    <TableCell>
                      {r.supplierRespondedAt ? (
                        <Badge variant="success">{t('yes')}</Badge>
                      ) : (
                        <Badge variant="secondary">{t('no')}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
