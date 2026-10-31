'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Scissors } from 'lucide-react';
import { usePreviewCuttingPlan } from '@/lib/hooks/use-cutting';
import { useWarehouses } from '@/lib/hooks/use-inventory';
import { useHasPermission } from '@/lib/hooks/use-roles';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

/** Розкрій (2026-10-31) — entry point: pick qty/warehouse, "Порахувати розкрій" runs the optimizer and lands on the DRAFT plan's own review/print page. */
export default function AssemblyCuttingPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('cutting');
  const tBom = useTranslations('bom');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const { data: warehouses } = useWarehouses();
  const preview = usePreviewCuttingPlan();
  const canWrite = useHasPermission('cutting:write');

  const [qty, setQty] = useState('');
  const [warehouseId, setWarehouseId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  async function handleCalculate() {
    const qtyNum = Number(qty);
    if (!qtyNum || qtyNum <= 0) return;
    setError(null);
    try {
      const plan = await preview.mutateAsync({ assemblyId: params.id, qty: qtyNum, warehouseId });
      router.push(`/bom/${params.id}/cutting/${plan.id}`);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('calculateCuttingDialogTitle')}</CardTitle>
          <CardDescription>{t('calculateCuttingDialogDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cutting-qty">{t('calculateCuttingQtyLabel')}</Label>
              <Input id="cutting-qty" type="number" step="any" min={0} value={qty} onChange={(e) => setQty(e.target.value)} className="w-32" />
            </div>
            <div className="space-y-1.5">
              <Label>{tBom('warehouse')}</Label>
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
            {canWrite && (
              <Button onClick={handleCalculate} loading={preview.isPending} disabled={!qty}>
                <Scissors className="mr-2 h-4 w-4" />
                {t('calculateCutting')}
              </Button>
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
