'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LoadingBlock } from '@/components/ui/loading-block';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supplierPortalApi } from '@/lib/supplier-portal/api';
import { useApiErrorMessage } from '@/lib/api-error-message';

interface StockRow {
  itemId: string;
  orderId: string;
  productId: string | null;
  article: string;
  productName: string;
  orderDate: string;
  qtyOrdered: number;
  qtyReceived: number;
  qtyRemaining: number;
  supplierReadyQty: number | null;
  photoUrl: string | null;
}

/**
 * "Склад" (2026-11-02) — not our own warehouse (too sensitive to show an
 * external supplier), but theirs: a lightweight ASN-style self-declaration
 * of how much of each open order line is already finished and sitting at
 * the supplier's own premises, not yet shipped. The user's own words:
 * "деталі які він виготовив але ще нам не відправив і вони висять на
 * балансі у нього на складі."
 */
export default function SupplierPortalStockPage() {
  const t = useTranslations('supplierPortal');
  const tc = useTranslations('common');
  const router = useRouter();
  const apiErrorMessage = useApiErrorMessage();

  const [rows, setRows] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await supplierPortalApi.get<{ items: StockRow[] }>('supplier-portal/stock');
      setRows(res.items);
      const seeded: Record<string, string> = {};
      for (const row of res.items) {
        seeded[row.itemId] = row.supplierReadyQty != null ? String(row.supplierReadyQty) : '';
      }
      setDraft(seeded);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave(itemId: string) {
    setErrors((prev) => ({ ...prev, [itemId]: '' }));
    setSavingId(itemId);
    try {
      await supplierPortalApi.patch(`supplier-portal/stock/${itemId}`, { supplierReadyQty: Number(draft[itemId] || 0) });
      await load();
    } catch (err) {
      setErrors((prev) => ({ ...prev, [itemId]: apiErrorMessage(err, tc('error')) }));
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return <LoadingBlock />;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t('navStock')}</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('navStock')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12" />
                <TableHead>{t('article')}</TableHead>
                <TableHead>{t('productName')}</TableHead>
                <TableHead>{t('qty')}</TableHead>
                <TableHead>{t('stockRemainingLabel')}</TableHead>
                <TableHead className="w-48">{t('stockReadyLabel')}</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    {t('noStockItems')}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.itemId}>
                    <TableCell>
                      <Avatar src={row.photoUrl} size="sm" />
                    </TableCell>
                    <TableCell className="cursor-pointer" onClick={() => router.push(`/supplier-portal/orders/${row.orderId}`)}>
                      {row.article}
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate" title={row.productName}>{row.productName}</TableCell>
                    <TableCell>{row.qtyOrdered}</TableCell>
                    <TableCell>{row.qtyRemaining}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="any"
                        min={0}
                        max={row.qtyRemaining}
                        value={draft[row.itemId] ?? ''}
                        onChange={(e) => setDraft((prev) => ({ ...prev, [row.itemId]: e.target.value }))}
                      />
                      {errors[row.itemId] && <p className="mt-1 text-xs text-destructive">{errors[row.itemId]}</p>}
                    </TableCell>
                    <TableCell>
                      <Button type="button" size="sm" variant="outline" loading={savingId === row.itemId} onClick={() => handleSave(row.itemId)}>
                        {tc('save')}
                      </Button>
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
