'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCreateShipment, useCalculateShipmentMetrics } from '@/lib/hooks/use-sales';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { CustomerOrderPicker } from '@/components/domain/sales/customer-order-picker';
import { FinishedGoodSelector } from '@/components/domain/sales/finished-good-selector';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { RequirePermission } from '@/components/domain/auth/require-permission';

export default function NewShipmentPage() {
  const t = useTranslations('sales');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const router = useRouter();
  const createShipment = useCreateShipment();

  const [customerOrderId, setCustomerOrderId] = useState<string | undefined>(undefined);
  const [carrier, setCarrier] = useState('');
  const [waybillNumber, setWaybillNumber] = useState('');
  const [packageCount, setPackageCount] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [dimensions, setDimensions] = useState('');
  const [comment, setComment] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Live weight/place/volume/transport-count preview (2026-10-28): debounced
  // on the FinishedGood selection so quickly toggling checkboxes doesn't
  // fire a request per click. On a successful calc, pre-fills the
  // weightKg/packageCount inputs above — they stay hand-editable afterward
  // (same "calculate -> prefill -> user can still override" idiom as
  // assembly-form.tsx's GermanPriceFromBomCalculator), so a real scale
  // reading or a manual correction is never clobbered by a later recalc
  // unless the selection itself changes again.
  const calculateMetrics = useCalculateShipmentMetrics();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (selectedIds.length === 0) return;
    debounceRef.current = setTimeout(() => {
      calculateMetrics.mutate(selectedIds, {
        onSuccess: (metrics) => {
          setPackageCount(String(metrics.totalPlaces));
          setWeightKg(String(Math.round(metrics.totalWeightKg * 100) / 100));
        },
      });
    }, 400);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds]);
  const metrics = calculateMetrics.data;

  async function handleSubmit() {
    setError(null);
    if (selectedIds.length === 0) {
      setError(t('invalidShipment'));
      return;
    }
    try {
      const shipment = await createShipment.mutateAsync({
        customerOrderId,
        carrier: carrier || undefined,
        waybillNumber: waybillNumber || undefined,
        packageCount: packageCount ? Number(packageCount) : undefined,
        weightKg: weightKg ? Number(weightKg) : undefined,
        dimensions: dimensions || undefined,
        comment: comment || undefined,
        finishedGoodIds: selectedIds,
      });
      router.replace(`/sales/shipments/${shipment.id}`);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <RequirePermission permission="shipments:manage" redirectTo="/sales/shipments">
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">{t('newShipment')}</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('shipmentHeader')}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t('linkCustomerOrder')}</Label>
            <CustomerOrderPicker value={customerOrderId} onChange={(id) => setCustomerOrderId(id)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="carrier">{t('carrier')}</Label>
            <Input id="carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="waybillNumber">{t('waybillNumber')}</Label>
            <Input id="waybillNumber" value={waybillNumber} onChange={(e) => setWaybillNumber(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="packageCount">{t('packageCount')}</Label>
            <Input id="packageCount" type="number" min={1} step="1" value={packageCount} onChange={(e) => setPackageCount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="weightKg">{t('weightKg')}</Label>
            <Input id="weightKg" type="number" min={0} step="any" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dimensions">{t('dimensions')}</Label>
            <Input id="dimensions" value={dimensions} onChange={(e) => setDimensions(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="comment">{t('comment')}</Label>
            <Textarea id="comment" value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('selectFinishedGoods')}</CardTitle>
        </CardHeader>
        <CardContent>
          <FinishedGoodSelector selectedIds={selectedIds} onChange={setSelectedIds} />
        </CardContent>
      </Card>

      {selectedIds.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('shipmentCalculation')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {calculateMetrics.isPending && !metrics ? (
              <p className="text-sm text-muted-foreground">{tc('loading')}</p>
            ) : metrics ? (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-muted-foreground">{t('calculatedWeight')}</p>
                    <p className="font-medium">{metrics.totalWeightKg.toFixed(2)} {t('kgUnit')}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t('calculatedPlaces')}</p>
                    <p className="font-medium">{metrics.totalPlaces}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t('calculatedVolume')}</p>
                    <p className="font-medium">{metrics.totalVolumeM3 != null ? `${metrics.totalVolumeM3.toFixed(3)} ${t('m3Unit')}` : '—'}</p>
                  </div>
                </div>
                {metrics.weightIncomplete && <p className="text-xs text-amber-600 dark:text-amber-500">{t('weightIncompleteWarning')}</p>}
                {metrics.volumeIncomplete && <p className="text-xs text-amber-600 dark:text-amber-500">{t('volumeIncompleteWarning')}</p>}

                {metrics.transportSuggestions.length > 0 && (
                  <div className="space-y-1.5 border-t border-border pt-3">
                    <p className="text-sm font-medium">{t('transportNeeded')}</p>
                    <ul className="space-y-1 text-sm">
                      {metrics.transportSuggestions.map((s) => (
                        <li key={s.typeId} className="flex justify-between">
                          <span className="text-muted-foreground">{s.name}</span>
                          <span className="font-medium">{t('transportUnitsCount', { count: s.unitsNeeded })}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : null}
          </CardContent>
        </Card>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button onClick={handleSubmit} loading={createShipment.isPending}>
        {tc('create')}
      </Button>
    </div>
    </RequirePermission>
  );
}
