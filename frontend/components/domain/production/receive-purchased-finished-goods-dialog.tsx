'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useReceivePurchasedFinishedGoods } from '@/lib/hooks/use-production';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { AssemblyPicker } from '@/components/domain/bom/assembly-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';

/**
 * Stocks units bought ready-made from a supplier — the direct counterpart
 * to "Розпочати виробництво" (start()), for the case where a product or
 * sub-assembly was never manufactured in-house at all. No BOM, no labor
 * fund, no ProductionOrder — just serial numbers, a cost, and a shelf.
 */
export function ReceivePurchasedFinishedGoodsDialog() {
  const t = useTranslations('production');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const receive = useReceivePurchasedFinishedGoods();

  const [open, setOpen] = useState(false);
  const [assemblyId, setAssemblyId] = useState<string | undefined>(undefined);
  const [qty, setQty] = useState('');
  const [unitCostEur, setUnitCostEur] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setAssemblyId(undefined);
    setQty('');
    setUnitCostEur('');
    setComment('');
    setError(null);
  }

  async function handleSubmit() {
    setError(null);
    const qtyNum = Number(qty);
    const costNum = Number(unitCostEur);
    if (!assemblyId || !qtyNum || qtyNum <= 0 || !Number.isInteger(qtyNum)) {
      setError(t('invalidOrder'));
      return;
    }
    if (unitCostEur === '' || Number.isNaN(costNum) || costNum < 0) {
      setError(t('invalidCost'));
      return;
    }
    try {
      await receive.mutateAsync({ assemblyId, qty: qtyNum, unitCostEur: costNum, comment: comment || undefined });
      setOpen(false);
      reset();
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {t('receivePurchased')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('receivePurchasedTitle')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t('assembly')}</Label>
            <AssemblyPicker value={assemblyId} onChange={(id) => setAssemblyId(id)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rpfg-qty">{t('qty')}</Label>
            <Input id="rpfg-qty" type="number" step="1" min={1} value={qty} onChange={(e) => setQty(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rpfg-cost">{t('unitCostEur')}</Label>
            <Input
              id="rpfg-cost"
              type="number"
              step="0.01"
              min={0}
              value={unitCostEur}
              onChange={(e) => setUnitCostEur(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rpfg-comment">{t('receivePurchasedCommentLabel')}</Label>
            <Textarea id="rpfg-comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('receivePurchasedCommentPlaceholder')} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{tc('cancel')}</Button>
          </DialogClose>
          <Button onClick={handleSubmit} loading={receive.isPending}>
            {tc('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
