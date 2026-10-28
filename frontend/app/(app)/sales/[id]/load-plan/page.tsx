'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { DndContext, type DragEndEvent, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { useTransportUnitTypes } from '@/lib/hooks/use-logistics';
import { useLoadPlan, useGenerateLoadPlan, useMoveLoadPlanItem } from '@/lib/hooks/use-sales';
import { useApiErrorMessage } from '@/lib/api-error-message';
import type { LoadPlanTruck, LoadPlanTruckItem } from '@/lib/api-client/sales';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { LoadingBlock } from '@/components/ui/loading-block';
import { RequirePermission } from '@/components/domain/auth/require-permission';
import { TruckLoadViewer, colorForAssembly } from '@/components/domain/sales/truck-load-viewer';

export default function LoadPlanPage() {
  const { id: orderId } = useParams<{ id: string }>();
  const t = useTranslations('sales');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();

  const { data: transportTypes, isLoading: typesLoading } = useTransportUnitTypes();
  const { data: plan, isLoading: planLoading } = useLoadPlan(orderId);
  const generatePlan = useGenerateLoadPlan(orderId);
  const moveItem = useMoveLoadPlanItem(orderId);

  const sizedTypes = (transportTypes ?? []).filter((tp) => tp.active && tp.lengthCm && tp.widthCm && tp.heightCm);

  const [selectedTypeId, setSelectedTypeId] = useState<string | undefined>(undefined);
  const [selectedTruckIndex, setSelectedTruckIndex] = useState<number | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedTypeId && plan) setSelectedTypeId(plan.transportUnitTypeId);
    else if (!selectedTypeId && sizedTypes.length > 0) setSelectedTypeId(sizedTypes[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, sizedTypes.length]);

  // "за замовчуванням... обирало в фури завантаження" (2026-10-28): auto-
  // generate on first open if there's no plan yet and a usable transport
  // type exists — the user shouldn't have to press anything to see a plan.
  const autoGenerateEligible = !planLoading && !plan && selectedTypeId && !generatePlan.isPending;
  useEffect(() => {
    if (autoGenerateEligible) handleGenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerateEligible]);

  useEffect(() => {
    if (plan && plan.trucks.length > 0 && selectedTruckIndex == null) setSelectedTruckIndex(plan.trucks[0].index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  async function handleGenerate() {
    if (!selectedTypeId) return;
    setGenerateError(null);
    try {
      await generatePlan.mutateAsync(selectedTypeId);
    } catch (err) {
      setGenerateError(apiErrorMessage(err, tc('error')));
    }
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const toTruckIndex = Number(String(over.id).replace('truck-', ''));
    const itemId = String(active.id).replace('item-', '');
    const fromTruck = plan?.trucks.find((tr) => tr.items.some((i) => i.id === itemId));
    if (!fromTruck || fromTruck.index === toTruckIndex) return;
    moveItem.mutate({ itemId, toTruckIndex });
  }

  const selectedTruck = plan?.trucks.find((tr) => tr.index === selectedTruckIndex) ?? null;
  const assemblyNames = new Map<string, string>();
  for (const truck of plan?.trucks ?? []) for (const item of truck.items) assemblyNames.set(item.assemblyId, item.assemblyName);
  const planTransportType = plan ? (transportTypes ?? []).find((tp) => tp.id === plan.transportUnitTypeId) : undefined;
  const truckDims = planTransportType
    ? { lengthCm: Number(planTransportType.lengthCm), widthCm: Number(planTransportType.widthCm), heightCm: Number(planTransportType.heightCm) }
    : { lengthCm: 0, widthCm: 0, heightCm: 0 };

  return (
    <RequirePermission permission="shipments:manage" redirectTo={`/sales/${orderId}`}>
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">{t('loadPlanTitle')}</h1>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('loadPlanTransportType')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            {typesLoading ? (
              <LoadingBlock />
            ) : sizedTypes.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('loadPlanNoSizedTypes')}</p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Select value={selectedTypeId} onValueChange={setSelectedTypeId}>
                    <SelectTrigger className="w-64">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {sizedTypes.map((tp) => (
                        <SelectItem key={tp.id} value={tp.id}>
                          {tp.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={handleGenerate} loading={generatePlan.isPending} disabled={!selectedTypeId}>
                  {t('loadPlanRegenerate')}
                </Button>
              </>
            )}
          </CardContent>
          {generateError && (
            <CardContent className="pt-0">
              <p className="text-sm text-destructive">{generateError}</p>
            </CardContent>
          )}
        </Card>

        {planLoading || generatePlan.isPending ? (
          <LoadingBlock />
        ) : !plan ? (
          sizedTypes.length === 0 ? null : <p className="text-sm text-muted-foreground">{t('loadPlanEmpty')}</p>
        ) : (
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {plan.trucks.map((truck) => (
                <TruckColumn
                  key={truck.id}
                  truck={truck}
                  selected={truck.index === selectedTruckIndex}
                  onSelect={() => setSelectedTruckIndex(truck.index)}
                />
              ))}
              <TruckColumn
                truck={{ id: 'new', index: (plan.trucks.at(-1)?.index ?? 0) + 1, items: [], placedBoxes: [], overflowBoxCount: 0, totalWeightKg: 0, volumeUsedPercent: 0 }}
                selected={false}
                onSelect={() => {}}
                isNewDropZone
              />
            </div>

            {selectedTruck && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {t('loadPlanTruckNumber', { index: selectedTruck.index })} — {selectedTruck.totalWeightKg.toFixed(1)} {t('kgUnit')},{' '}
                    {selectedTruck.volumeUsedPercent.toFixed(0)}% {t('loadPlanVolumeUsed')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {selectedTruck.overflowBoxCount > 0 && (
                    <p className="text-sm text-amber-600 dark:text-amber-500">{t('loadPlanOverflowWarning', { count: selectedTruck.overflowBoxCount })}</p>
                  )}
                  <TruckLoadViewer truckDims={truckDims} placedBoxes={selectedTruck.placedBoxes} />
                  <div className="flex flex-wrap gap-3">
                    {[...assemblyNames.entries()].map(([assemblyId, name]) => (
                      <div key={assemblyId} className="flex items-center gap-1.5 text-xs">
                        <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: colorForAssembly(assemblyId) }} />
                        {name}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </DndContext>
        )}
      </div>
    </RequirePermission>
  );
}

function TruckColumn({
  truck,
  selected,
  onSelect,
  isNewDropZone,
}: {
  truck: LoadPlanTruck;
  selected: boolean;
  onSelect: () => void;
  isNewDropZone?: boolean;
}) {
  const t = useTranslations('sales');
  const { setNodeRef, isOver } = useDroppable({ id: `truck-${truck.index}` });

  return (
    <div
      ref={setNodeRef}
      onClick={onSelect}
      className={`flex w-56 shrink-0 flex-col gap-2 rounded-md border p-2 transition-colors ${
        selected ? 'border-primary' : 'border-border'
      } ${isOver ? 'bg-accent' : ''} ${isNewDropZone ? 'border-dashed' : ''} cursor-pointer`}
    >
      <p className="text-sm font-medium">
        {isNewDropZone ? t('loadPlanNewTruck') : t('loadPlanTruckNumber', { index: truck.index })}
      </p>
      {!isNewDropZone && <p className="text-xs text-muted-foreground">{truck.totalWeightKg.toFixed(1)} {t('kgUnit')}</p>}
      <div className="flex flex-col gap-1.5">
        {truck.items.map((item) => (
          <DraggableItemCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

function DraggableItemCard({ item }: { item: LoadPlanTruckItem }) {
  const t = useTranslations('sales');
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `item-${item.id}` });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 10 } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`cursor-grab rounded border border-border bg-card p-1.5 text-xs shadow-sm active:cursor-grabbing ${isDragging ? 'opacity-50' : ''}`}
    >
      <p className="font-medium">{item.assemblyName}</p>
      <p className="text-muted-foreground">
        {t('transportUnitsCount', { count: item.unitsQty })} · {item.weightKg.toFixed(1)} {t('kgUnit')}
      </p>
    </div>
  );
}
