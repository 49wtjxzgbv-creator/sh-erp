'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAddCustomerOrderItem } from '@/lib/hooks/use-sales';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { AssemblyPicker } from '@/components/domain/bom/assembly-picker';

export interface AddCustomerOrderItemDialogProps {
  orderId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Same plain-useState/manual-validation shape as EditCustomerOrderDialog —
 * no zod/react-hook-form anywhere in this module. Resets its fields every
 * time it opens (not just at mount), same reasoning as that dialog's own
 * re-seed effect.
 */
export function AddCustomerOrderItemDialog({ orderId, open, onOpenChange }: AddCustomerOrderItemDialogProps) {
  const t = useTranslations('sales');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const addItem = useAddCustomerOrderItem(orderId);

  const [assemblyId, setAssemblyId] = useState<string | undefined>(undefined);
  const [qty, setQty] = useState('1');
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(v: boolean) {
    if (v) {
      setAssemblyId(undefined);
      setQty('1');
      setError(null);
    }
    onOpenChange(v);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsedQty = Number(qty);
    if (!assemblyId || !Number.isFinite(parsedQty) || parsedQty <= 0) {
      setError(t('invalidNewItem'));
      return;
    }
    try {
      await addItem.mutateAsync({ assemblyId, qty: parsedQty });
      handleOpenChange(false);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('addItemDialogTitle')}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <Label>{t('assembly')}</Label>
            <AssemblyPicker value={assemblyId} onChange={(id) => setAssemblyId(id)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="add-item-qty">{t('qty')}</Label>
            <Input id="add-item-qty" type="number" step="any" min={0.001} value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" loading={addItem.isPending}>
              {tc('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
