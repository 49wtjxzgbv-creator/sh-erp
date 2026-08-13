'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRecordStockMovement, useWarehouses } from '@/lib/hooks/use-inventory';
import { useApiErrorMessage } from '@/lib/api-error-message';
import type { SingleWarehouseMovementType } from '@/lib/api-client/inventory';
import { ProductPicker } from '@/components/domain/catalog/product-picker';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

const MOVEMENT_TYPES: SingleWarehouseMovementType[] = ['RECEIVE', 'ISSUE', 'ADJUST', 'DEFECT_WRITE_OFF'];

// Explicit map rather than deriving the message key from the enum value
// (e.g. `movementType${toPascalCase(type)}`) — a string-munging key lookup
// is exactly the kind of "looks right, breaks silently on the next enum
// value" trap next-intl can't type-check for us.
const MOVEMENT_TYPE_LABEL_KEYS: Record<SingleWarehouseMovementType, string> = {
  RECEIVE: 'movementTypeReceive',
  ISSUE: 'movementTypeIssue',
  ADJUST: 'movementTypeAdjust',
  DEFECT_WRITE_OFF: 'movementTypeDefectWriteOff',
};

export interface RecordMovementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RecordMovementDialog({ open, onOpenChange }: RecordMovementDialogProps) {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const { data: warehouses } = useWarehouses();
  const recordMovement = useRecordStockMovement();

  const [productId, setProductId] = useState<string | undefined>();
  const [warehouseId, setWarehouseId] = useState<string | undefined>();
  const [type, setType] = useState<SingleWarehouseMovementType>('RECEIVE');
  const [qtyDelta, setQtyDelta] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setProductId(undefined);
    setWarehouseId(undefined);
    setType('RECEIVE');
    setQtyDelta('');
    setComment('');
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const delta = Number(qtyDelta);
    if (!productId || !warehouseId || !delta) return;
    try {
      await recordMovement.mutateAsync({ productId, warehouseId, type, qtyDelta: delta, comment: comment || undefined });
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('recordMovement')}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <Label>{t('product')}</Label>
            <ProductPicker value={productId} onChange={(id) => setProductId(id)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t('warehouse')}</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger>
                <SelectValue placeholder={t('warehouse')} />
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
            <Label>{t('movementType')}</Label>
            <Select value={type} onValueChange={(v) => setType(v as SingleWarehouseMovementType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MOVEMENT_TYPES.map((mt) => (
                  <SelectItem key={mt} value={mt}>
                    {t(MOVEMENT_TYPE_LABEL_KEYS[mt])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qtyDelta">{t('qtyDelta')}</Label>
            <Input
              id="qtyDelta"
              type="number"
              step="any"
              value={qtyDelta}
              onChange={(e) => setQtyDelta(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="comment">{t('comment')}</Label>
            <Input id="comment" value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" loading={recordMovement.isPending} disabled={!productId || !warehouseId || !qtyDelta}>
              {tc('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
