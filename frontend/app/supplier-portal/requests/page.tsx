'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supplierPortalApi } from '@/lib/supplier-portal/api';
import type { PurchaseRequestStatus } from '@/lib/api-client/procurement';

interface PortalPurchaseRequestRow {
  id: string;
  number: string;
  createdAt: string;
  status: PurchaseRequestStatus;
  supplierRespondedAt: string | null;
  items: { id: string }[];
}

const REQUEST_STATUS_VARIANT: Record<PurchaseRequestStatus, 'secondary' | 'warning' | 'success'> = {
  DRAFT: 'secondary',
  SENT: 'warning',
  CONVERTED: 'success',
  CANCELLED: 'secondary',
};

export default function SupplierPortalRequestsPage() {
  const t = useTranslations('supplierPortal');
  const router = useRouter();
  const [requests, setRequests] = useState<PortalPurchaseRequestRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Same swallow-on-error convention as the orders list.
      const res = await supplierPortalApi.get<{ items: PortalPurchaseRequestRow[] }>('supplier-portal/purchase-requests');
      setRequests(res.items);
    } catch {
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t('yourPurchaseRequests')}</h1>
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
              {loading ? (
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
