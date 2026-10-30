'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAddLoadPlanItem } from '@/lib/hooks/use-sales';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { AssemblyPicker } from '@/components/domain/bom/assembly-picker';

export interface AddLoadPlanItemDialogProps {
  orderId: string;
  truckIndex: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Ad-hoc load-plan item (2026-10-30, "також додавати той якого нема в
 * замовленні") — same plain-useState shape as AddCustomerOrderItemDialog,
 * no zod/react-hook-form. Two modes, switched by a Tabs trigger-only strip
 * (no TabsContent — this dialog is small enough that swapping a few fields
 * inline reads better than two whole panels): a real Assembly pick (same
 * packaging/weight as an order line) or a fully manual box with no catalog
 * link at all.
 */
export function AddLoadPlanItemDialog({ orderId, truckIndex, open, onOpenChange }: AddLoadPlanItemDialogProps) {
  const t = useTranslations('sales');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const addItem = useAddLoadPlanItem(orderId);

  const [mode, setMode] = useState<'catalog' | 'manual'>('catalog');
  const [assemblyId, setAssemblyId] = useState<string | undefined>(undefined);
  const [manualName, setManualName] = useState('');
  const [manualLengthCm, setManualLengthCm] = useState('');
  const [manualWidthCm, setManualWidthCm] = useState('');
  const [manualHeightCm, setManualHeightCm] = useState('');
  const [manualWeightKg, setManualWeightKg] = useState('');
  const [qty, setQty] = useState('1');
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(v: boolean) {
    if (v) {
      setMode('catalog');
      setAssemblyId(undefined);
      setManualName('');
      setManualLengthCm('');
      setManualWidthCm('');
      setManualHeightCm('');
      setManualWeightKg('');
      setQty('1');
      setError(null);
    }
    onOpenChange(v);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsedQty = Number(qty);
    if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
      setError(t('loadPlanAddItemInvalidQty'));
      return;
    }
    try {
      if (mode === 'catalog') {
        if (!assemblyId) {
          setError(t('loadPlanAddItemPickAssembly'));
          return;
        }
        await addItem.mutateAsync({ truckIndex, assemblyId, unitsQty: parsedQty });
      } else {
        const lengthCm = Number(manualLengthCm);
        const widthCm = Number(manualWidthCm);
        const heightCm = Number(manualHeightCm);
        const weightKg = Number(manualWeightKg);
        if (!manualName.trim() || ![lengthCm, widthCm, heightCm, weightKg].every((v) => Number.isFinite(v) && v >= 0) || lengthCm <= 0 || widthCm <= 0 || heightCm <= 0) {
          setError(t('loadPlanAddItemInvalidManual'));
          return;
        }
        await addItem.mutateAsync({ truckIndex, manualName: manualName.trim(), manualLengthCm: lengthCm, manualWidthCm: widthCm, manualHeightCm: heightCm, manualWeightKg: weightKg, unitsQty: parsedQty });
      }
      handleOpenChange(false);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('loadPlanAddItemDialogTitle')}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="flex gap-2">
            <Button type="button" variant={mode === 'catalog' ? 'default' : 'outline'} size="sm" onClick={() => setMode('catalog')}>
              {t('loadPlanAddItemFromCatalog')}
            </Button>
            <Button type="button" variant={mode === 'manual' ? 'default' : 'outline'} size="sm" onClick={() => setMode('manual')}>
              {t('loadPlanAddItemManualBox')}
            </Button>
          </div>

          {mode === 'catalog' ? (
            <div className="space-y-1.5">
              <Label>{t('assembly')}</Label>
              <AssemblyPicker value={assemblyId} onChange={(id) => setAssemblyId(id)} />
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="load-plan-manual-name">{t('loadPlanAddItemManualName')}</Label>
                <Input id="load-plan-manual-name" value={manualName} onChange={(e) => setManualName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('boxDimensionsCm')}</Label>
                <div className="grid grid-cols-3 gap-2">
                  <Input type="number" step="any" min="0" placeholder={t('boxLength')} value={manualLengthCm} onChange={(e) => setManualLengthCm(e.target.value)} />
                  <Input type="number" step="any" min="0" placeholder={t('boxWidth')} value={manualWidthCm} onChange={(e) => setManualWidthCm(e.target.value)} />
                  <Input type="number" step="any" min="0" placeholder={t('boxHeight')} value={manualHeightCm} onChange={(e) => setManualHeightCm(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="load-plan-manual-weight">{t('loadPlanAddItemManualWeightKg')}</Label>
                <Input id="load-plan-manual-weight" type="number" step="any" min="0" value={manualWeightKg} onChange={(e) => setManualWeightKg(e.target.value)} />
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="load-plan-add-item-qty">{t('loadPlanAddItemQty')}</Label>
            <Input id="load-plan-add-item-qty" type="number" step="1" min="1" value={qty} onChange={(e) => setQty(e.target.value)} />
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
