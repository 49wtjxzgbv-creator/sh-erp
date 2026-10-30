'use client';

import { useTranslations } from 'next-intl';
import { PrintArea, PrintDocumentHeader, PreviewButton, PrintButton } from '@/components/domain/print/print-area';
import type { LoadPlan, LoadPlanPlacedBox } from '@/lib/api-client/sales';
import { LoadPlan2DView } from './load-plan-2d-view';

export interface LoadPlanPrintProps {
  customerOrderId: string;
  plan: LoadPlan;
  /** Same map the page already builds for the 3D legend — assemblyId (real or synthetic, see LoadPlanService#get) -> display name. */
  namesByAssemblyId: Map<string, string>;
  truckDims: { lengthCm: number; widthCm: number; heightCm: number };
}

/**
 * Printable loading instructions (2026-10-30, "потрібно додати якусь...
 * інструкцію") — warehouse/driver-facing: per truck, the 2D top-down map
 * (LoadPlan2DView) plus a build-bottom-up loading order and the existing
 * strap recommendation as plain text. No new backend data — everything
 * here already comes from `GET .../load-plan` (the same `plan` prop the
 * page's 3D view already has), grouped client-side.
 */
export function LoadPlanPrint({ customerOrderId, plan, namesByAssemblyId, truckDims }: LoadPlanPrintProps) {
  const t = useTranslations('sales');
  const tp = useTranslations('print');

  return (
    <>
      <div className="flex gap-2">
        <PrintButton label={t('loadPlanPrintButton')} />
        <PreviewButton printAreaId="load-plan-instructions" />
      </div>
      <PrintArea printAreaId="load-plan-instructions">
        <PrintDocumentHeader title={t('loadPlanPrintTitle')} subtitle={`${plan.transportUnitTypeName} — ${tp('orderId')} ${customerOrderId.slice(0, 8)}`} />
        {plan.trucks.map((truck, i) => {
          const levels = groupByLevel(truck.placedBoxes);
          return (
            <div key={truck.id} className={i < plan.trucks.length - 1 ? 'print-page-break' : ''}>
              <h2 className="mb-2 text-base font-semibold">
                {t('loadPlanTruckNumber', { index: truck.index })} — {truck.totalWeightKg.toFixed(1)} {t('kgUnit')}, {truck.volumeUsedPercent.toFixed(0)}% {t('loadPlanVolumeUsed')}
              </h2>
              <LoadPlan2DView truckDims={truckDims} placedBoxes={truck.placedBoxes} namesByAssemblyId={namesByAssemblyId} view="top" className="mb-3 max-h-64" />
              <ol className="mb-3 space-y-2 pl-5 text-sm">
                {levels.map(([z, boxes], levelIndex) => (
                  <li key={z}>
                    {t('loadPlanPrintLevel', { level: levelIndex + 1 })}:{' '}
                    {tallyByAssembly(boxes, namesByAssemblyId)
                      .map(({ name, count }) => `${name} × ${count}`)
                      .join(', ')}
                  </li>
                ))}
              </ol>
              {truck.strapPlan && (
                <p className="text-xs text-gray-700">
                  {t('loadPlanStrapRecommendation', { count: truck.strapPlan.count, length: truck.strapPlan.lengthCm })}
                </p>
              )}
            </div>
          );
        })}
      </PrintArea>
    </>
  );
}

/** Same level a box belongs to in the 3D view shares its exact z — the packer builds one full floor-level at a time, so grouping by z reproduces "everything in this level" exactly, in the order a worker would actually build the load (bottom level first). */
function groupByLevel(placedBoxes: LoadPlanPlacedBox[]): [number, LoadPlanPlacedBox[]][] {
  const levels = new Map<number, LoadPlanPlacedBox[]>();
  for (const box of placedBoxes) {
    const key = Math.round(box.z * 100) / 100;
    const existing = levels.get(key);
    if (existing) existing.push(box);
    else levels.set(key, [box]);
  }
  return [...levels.entries()].sort((a, b) => a[0] - b[0]);
}

function tallyByAssembly(boxes: LoadPlanPlacedBox[], namesByAssemblyId: Map<string, string>): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const box of boxes) counts.set(box.assemblyId, (counts.get(box.assemblyId) ?? 0) + 1);
  return [...counts.entries()].map(([assemblyId, count]) => ({ name: namesByAssemblyId.get(assemblyId) ?? assemblyId, count }));
}
