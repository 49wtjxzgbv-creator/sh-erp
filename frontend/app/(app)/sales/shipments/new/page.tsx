'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCreateShipment } from '@/lib/hooks/use-sales';
import { ApiError } from '@/lib/api-client/types';
import { CustomerOrderPicker } from '@/components/domain/sales/customer-order-picker';
import { FinishedGoodSelector } from '@/components/domain/sales/finished-good-selector';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

export default function NewShipmentPage() {
  const t = useTranslations('sales');
  const tc = useTranslations('common');
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
      setError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  return (
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

      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button onClick={handleSubmit} loading={createShipment.isPending}>
        {tc('create')}
      </Button>
    </div>
  );
}
