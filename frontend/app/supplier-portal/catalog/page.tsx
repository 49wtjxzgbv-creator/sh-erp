'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supplierPortalApi } from '@/lib/supplier-portal/api';
import type { SupplierCatalogEntry } from '@/lib/api-client/supplier-catalog';

export default function SupplierPortalCatalogPage() {
  const t = useTranslations('supplierPortal');
  const router = useRouter();
  const [catalog, setCatalog] = useState<SupplierCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Same swallow-on-error convention as the orders/requests lists.
      const res = await supplierPortalApi.get<{ items: SupplierCatalogEntry[] }>('supplier-portal/catalog');
      setCatalog(res.items);
    } catch {
      setCatalog([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t('yourCatalog')}</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('yourCatalog')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12" />
                <TableHead>{t('article')}</TableHead>
                <TableHead>{t('productName')}</TableHead>
                <TableHead>{t('yourPrice')}</TableHead>
                <TableHead>{t('cuttingSpecLabel')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    {t('loading')}
                  </TableCell>
                </TableRow>
              ) : catalog.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    {t('noCatalogEntries')}
                  </TableCell>
                </TableRow>
              ) : (
                catalog.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => router.push(`/supplier-portal/catalog/${c.id}`)}>
                    <TableCell>
                      <Avatar src={c.photoUrl} size="sm" />
                    </TableCell>
                    <TableCell>{c.article}</TableCell>
                    <TableCell className="max-w-[260px] truncate" title={c.name}>{c.name}</TableCell>
                    <TableCell>{c.supplierOfferedPrice ?? '—'}</TableCell>
                    <TableCell>{c.cuttingSpec && <Badge variant="secondary">{t('cuttingSpecLabel')}</Badge>}</TableCell>
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
