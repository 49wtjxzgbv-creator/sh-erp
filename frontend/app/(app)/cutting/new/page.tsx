'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus, Scissors } from 'lucide-react';
import { usePreviewCuttingPlan } from '@/lib/hooks/use-cutting';
import { useWarehouses } from '@/lib/hooks/use-inventory';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { RequirePermission } from '@/components/domain/auth/require-permission';
import { AdHocCutRow, type AdHocRowState } from './ad-hoc-cut-row';

function newRow(): AdHocRowState {
  return {
    key: crypto.randomUUID(),
    materialMode: 'existing',
    materialProductId: '',
    materialKind: null,
    customLabel: '',
    customKind: 'BAR',
    customStockLengthCm: '',
    customStockWidthCm: '',
    customKerfMm: '',
    label: '',
    cutLengthCm: '',
    cutWidthCm: '',
    shapePolygon: null,
    qty: '',
  };
}

/**
 * Ad-hoc multi-material cutting worksheet (2026-11-01) — "обирати різні
 * позиції і кількість, або створювати свої форми і розміри декілька
 * різних або одну і робити розкрої": a scratchpad run with no assembly/BOM
 * and no saved product required per position, each position free to name
 * its own raw material — all grouped and nested per-material by the same
 * backend loop the assembly/direct-product paths already use.
 */
export default function NewAdHocCuttingPlanPage() {
  const t = useTranslations('cutting');
  const tBom = useTranslations('bom');
  const tc = useTranslations('common');
  const router = useRouter();
  const apiErrorMessage = useApiErrorMessage();
  const { data: warehouses } = useWarehouses();
  const preview = usePreviewCuttingPlan();

  const [rows, setRows] = useState<AdHocRowState[]>([newRow()]);
  const [warehouseId, setWarehouseId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  function updateRow(key: string, patch: Partial<AdHocRowState>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  const valid =
    rows.length > 0 &&
    rows.every((r) => {
      if (!r.cutLengthCm || !r.qty) return false;
      const isSheet = r.materialMode === 'existing' ? r.materialKind === 'SHEET' : r.customKind === 'SHEET';
      if (isSheet && !r.cutWidthCm) return false;
      if (r.materialMode === 'existing') return Boolean(r.materialProductId);
      return Boolean(r.customLabel && r.customStockLengthCm && (r.customKind === 'BAR' || r.customStockWidthCm));
    });

  async function handleCalculate() {
    if (!valid) return;
    setError(null);
    try {
      const plan = await preview.mutateAsync({
        warehouseId,
        lines: rows.map((r) => ({
          materialProductId: r.materialMode === 'existing' ? r.materialProductId : undefined,
          customMaterial:
            r.materialMode === 'custom'
              ? {
                  label: r.customLabel,
                  kind: r.customKind,
                  stockLengthCm: Number(r.customStockLengthCm),
                  stockWidthCm: r.customKind === 'SHEET' ? Number(r.customStockWidthCm) : undefined,
                  kerfMm: r.customKerfMm ? Number(r.customKerfMm) : undefined,
                }
              : undefined,
          label: r.label || undefined,
          qty: Number(r.qty),
          cutLengthCm: Number(r.cutLengthCm),
          cutWidthCm: r.cutWidthCm ? Number(r.cutWidthCm) : undefined,
          cutShapePolygon: r.shapePolygon ?? undefined,
        })),
      });
      router.push(`/cutting/${plan.id}`);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <RequirePermission permission="cutting:write" redirectTo="/cutting">
      <div className="max-w-3xl space-y-4">
        <div>
          <h1 className="text-xl font-semibold">{t('adHocTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('adHocDescription')}</p>
        </div>

        <div className="space-y-3">
          {rows.map((row) => (
            <AdHocCutRow
              key={row.key}
              row={row}
              onChange={(patch) => updateRow(row.key, patch)}
              onRemove={() => removeRow(row.key)}
              removable={rows.length > 1}
            />
          ))}
        </div>

        <Button type="button" variant="outline" size="sm" onClick={() => setRows((prev) => [...prev, newRow()])}>
          <Plus className="mr-2 h-4 w-4" />
          {t('adHocAddRow')}
        </Button>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('calculateCuttingDialogTitle')}</CardTitle>
            <CardDescription>{t('calculateCuttingDialogDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
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
              <Button onClick={handleCalculate} loading={preview.isPending} disabled={!valid}>
                <Scissors className="mr-2 h-4 w-4" />
                {t('calculateCutting')}
              </Button>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </CardContent>
        </Card>
      </div>
    </RequirePermission>
  );
}
