'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMoveStock, useWarehouses } from '@/lib/hooks/use-inventory';
import { ApiError } from '@/lib/api-client/types';
import { ProductPicker } from '@/components/domain/catalog/product-picker';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

export interface MoveStockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MoveStockDialog({ open, onOpenChange }: MoveStockDialogProps) {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const { data: warehouses } = useWarehouses();
  const moveStock = useMoveStock();

  const [productId, setProductId] = useState<string | undefined>();
  const [fromWarehouseId, setFromWarehouseId] = useState<string | undefined>();
  const [toWarehouseId, setToWarehouseId] = useState<string | undefined>();
  const [qty, setQty] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setProductId(undefined);
    setFromWarehouseId(undefined);
    setToWarehouseId(undefined);
    setQty('');
    setComment('');
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const qtyNum = Number(qty);
    if (!productId || !fromWarehouseId || !toWarehouseId || !qtyNum) return;
    if (fromWarehouseId === toWarehouseId) {
      setError(t('fromWarehouse') + ' ≠ ' + t('toWarehouse'));
      return;
    }
    try {
      await moveStock.mutateAsync({ productId, fromWarehouseId, toWarehouseId, qty: qtyNum, comment: comment || undefined });
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('moveStock')}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <Label>{t('product')}</Label>
            <ProductPicker value={productId} onChange={(id) => setProductId(id)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{t('fromWarehouse')}</Label>
              <Select value={fromWarehouseId} onValueChange={setFromWarehouseId}>
                <SelectTrigger>
                  <SelectValue placeholder={t('fromWarehouse')} />
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
            <div className="space-y-1.5">
              <Label>{t('toWarehouse')}</Label>
              <Select value={toWarehouseId} onValueChange={setToWarehouseId}>
                <SelectTrigger>
                  <SelectValue placeholder={t('toWarehouse')} />
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
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qty">{t('qty')}</Label>
            <Input id="qty" type="number" step="any" min={0} value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="comment">{t('comment')}</Label>
            <Input id="comment" value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              type="submit"
              loading={moveStock.isPending}
              disabled={!productId || !fromWarehouseId || !toWarehouseId || !qty}
            >
              {tc('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
