'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCheckAvailability, useProduceAssembly } from '@/lib/hooks/use-bom';
import { useWarehouses } from '@/lib/hooks/use-inventory';
import { useProduct } from '@/lib/hooks/use-catalog';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { ApiError } from '@/lib/api-client/types';
import type { AvailabilityResult } from '@/lib/api-client/bom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
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

/** AvailabilityResult's shortages only carry a raw productId — resolve to a real name/photo, same fix as everywhere else that showed a raw id. */
function ShortageProductCell({ productId }: { productId: string }) {
  const { data: product } = useProduct(productId);
  const { data: photosByProduct } = useFilesForEntities('Product', [productId]);
  return (
    <div className="flex items-center gap-2.5">
      <Avatar src={photosByProduct?.[productId]?.[0]?.downloadUrl} size="sm" />
      <span className="max-w-[180px] truncate" title={product?.name ?? productId}>
        {product ? `${product.name}${product.article ? ` (${product.article})` : ''}` : productId}
      </span>
    </div>
  );
}

export default function AssemblyAvailabilityPage() {
  const params = useParams<{ id: string }>();
  const t = useTranslations('bom');
  const tc = useTranslations('common');

  const { data: warehouses } = useWarehouses();
  const checkAvailability = useCheckAvailability();
  const produceAssembly = useProduceAssembly(params.id);

  const [qty, setQty] = useState('');
  const [warehouseId, setWarehouseId] = useState<string | undefined>(undefined);
  const [comment, setComment] = useState('');
  const [result, setResult] = useState<AvailabilityResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [produceSuccess, setProduceSuccess] = useState(false);

  async function handleCheck() {
    const qtyNum = Number(qty);
    if (!qtyNum) return;
    setError(null);
    setProduceSuccess(false);
    try {
      const r = await checkAvailability.mutateAsync({ assemblyId: params.id, qty: qtyNum });
      setResult(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  async function handleProduce() {
    const qtyNum = Number(qty);
    setError(null);
    try {
      await produceAssembly.mutateAsync({ qty: qtyNum, warehouseId, comment: comment || undefined });
      setProduceSuccess(true);
      setResult(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('checkAvailability')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="qty">{t('qty')}</Label>
              <Input id="qty" type="number" step="any" min={0} value={qty} onChange={(e) => setQty(e.target.value)} className="w-32" />
            </div>
            <div className="space-y-1.5">
              <Label>{t('warehouse')}</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses?.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleCheck} loading={checkAvailability.isPending} disabled={!qty}>
              {t('checkAvailability')}
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="comment">{t('comment')}</Label>
            <Input id="comment" value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>

          {result && (
            <div className="space-y-3">
              <Badge variant={result.sufficient ? 'success' : 'destructive'}>
                {result.sufficient ? t('sufficient') : t('insufficientStock')}
              </Badge>
              {result.shortages.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('component')}</TableHead>
                      <TableHead>{t('needed')}</TableHead>
                      <TableHead>{t('available')}</TableHead>
                      <TableHead>{t('shortage')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.shortages.map((s) => (
                      <TableRow key={s.productId}>
                        <TableCell><ShortageProductCell productId={s.productId} /></TableCell>
                        <TableCell>{s.needed}</TableCell>
                        <TableCell>{s.available}</TableCell>
                        <TableCell>{s.shortage}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {result.sufficient && (
                <Dialog>
                  <DialogTrigger asChild>
                    <Button>{t('produce')}</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{t('produceConfirmTitle')}</DialogTitle>
                      <DialogDescription>{t('produceConfirmDescription')}</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <DialogClose asChild>
                        <Button variant="outline">{tc('cancel')}</Button>
                      </DialogClose>
                      <Button loading={produceAssembly.isPending} onClick={handleProduce}>
                        {t('produce')}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          )}

          {produceSuccess && <p className="text-sm text-success">{t('produceSuccess')}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
