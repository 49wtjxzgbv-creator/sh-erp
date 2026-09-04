'use client';

import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { useAssembliesByIds, useAssemblyCosts } from '@/lib/hooks/use-bom';
import { useProductsByIds } from '@/lib/hooks/use-catalog';
import { toNumber } from '@/lib/api-client/decimal';
import { formatMoney } from '@/lib/finance-format';
import { computeLivePrice } from './pricing-method-field';
import { QuotationItemRow, type QuotationItemDraft } from './quotation-item-row';
import { Button } from '@/components/ui/button';

let draftCounter = 0;
function nextDraftId(): string {
  draftCounter += 1;
  return `draft-${Date.now()}-${draftCounter}`;
}

export function newDraftItem(defaultUnit: string): QuotationItemDraft {
  return {
    clientId: nextDraftId(),
    kind: 'CUSTOM',
    quantity: 1,
    unit: defaultUnit,
    pricingSource: 'CUSTOM',
    belowCostApproved: false,
  };
}

/**
 * Live client-side echo of the same subtotal/discount/total arithmetic
 * QuotationPricingService applies per line server-side — for instant
 * feedback only; the server recomputes authoritatively on save (§ same
 * note as pricing-method-field.tsx). Fetches cost/basePrice for every
 * ASSEMBLY/PRODUCT line via the same batch-by-id hooks
 * `sales/[id]/page.tsx#OrderPriceTotals` already uses — react-query
 * dedupes these against whatever each QuotationItemRow already fetched
 * for itself, so this is cache reuse, not a second round of requests.
 */
export function QuotationLiveTotals({ items, currency }: { items: QuotationItemDraft[]; currency: string }) {
  const t = useTranslations('quotations');
  const assemblyIds = items.filter((i) => i.kind === 'ASSEMBLY' && i.assemblyId).map((i) => i.assemblyId as string);
  const productIds = items.filter((i) => i.kind === 'PRODUCT' && i.productId).map((i) => i.productId as string);
  const { data: assembliesById } = useAssembliesByIds(assemblyIds);
  const { data: productsById } = useProductsByIds(productIds);
  const assemblyCostResults = useAssemblyCosts(items.map((i) => (i.kind === 'ASSEMBLY' ? i.assemblyId : undefined)));

  let subtotal = 0;
  let discountAmount = 0;
  let total = 0;
  items.forEach((item, index) => {
    const cost =
      item.kind === 'ASSEMBLY'
        ? assemblyCostResults[index]?.data?.costPerUnit ?? null
        : item.kind === 'PRODUCT' && item.productId
          ? toNumber(productsById?.get(item.productId)?.sellPriceEur ?? null)
          : null;
    const basePrice = item.kind === 'ASSEMBLY' && item.assemblyId ? toNumber(assembliesById?.get(item.assemblyId)?.baseSalePriceEur ?? null) : null;
    const laborCost = item.kind === 'ASSEMBLY' && item.assemblyId ? toNumber(assembliesById?.get(item.assemblyId)?.laborCostPerUnit ?? null) : null;
    const unitPrice = computeLivePrice(item.pricingSource, cost, basePrice, item.pricingPercent, item.customUnitPrice, laborCost);
    if (unitPrice === null) return;
    const lineSubtotal = unitPrice * item.quantity;
    const lineDiscount = lineSubtotal * ((item.discountPercent ?? 0) / 100);
    subtotal += lineSubtotal;
    discountAmount += lineDiscount;
    total += lineSubtotal - lineDiscount;
  });

  return (
    <div className="ml-auto w-full max-w-xs space-y-1 rounded-md border bg-muted/30 p-3 text-sm">
      <div className="flex justify-between text-muted-foreground">
        <span>{t('subtotal')}</span>
        <span>{formatMoney(subtotal, currency)}</span>
      </div>
      {discountAmount > 0 && (
        <div className="flex justify-between text-muted-foreground">
          <span>{t('totalDiscount')}</span>
          <span>-{formatMoney(discountAmount, currency)}</span>
        </div>
      )}
      <div className="flex justify-between border-t pt-1 text-base font-semibold">
        <span>{t('total')}</span>
        <span>{formatMoney(total, currency)}</span>
      </div>
    </div>
  );
}

export interface QuotationItemEditorProps {
  items: QuotationItemDraft[];
  currency: string;
  canViewMargin: boolean;
  editable: boolean;
  canApproveBelowCost: boolean;
  onItemsChange: (items: QuotationItemDraft[]) => void;
  onApproveBelowCost?: (item: QuotationItemDraft) => void;
  approvingItemId?: string;
}

export function QuotationItemEditor({
  items,
  currency,
  canViewMargin,
  editable,
  canApproveBelowCost,
  onItemsChange,
  onApproveBelowCost,
  approvingItemId,
}: QuotationItemEditorProps) {
  const t = useTranslations('quotations');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.clientId === active.id);
    const newIndex = items.findIndex((i) => i.clientId === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onItemsChange(arrayMove(items, oldIndex, newIndex));
  }

  function updateItem(clientId: string, patch: Partial<QuotationItemDraft>) {
    onItemsChange(items.map((i) => (i.clientId === clientId ? { ...i, ...patch } : i)));
  }

  function removeItem(clientId: string) {
    onItemsChange(items.filter((i) => i.clientId !== clientId));
  }

  function addItem() {
    onItemsChange([...items, newDraftItem(t('defaultUnit'))]);
  }

  return (
    <div className="space-y-3">
      {items.length === 0 && <p className="text-sm text-muted-foreground">{t('noItemsYet')}</p>}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map((i) => i.clientId)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {items.map((item) => (
              <QuotationItemRow
                key={item.clientId}
                item={item}
                currency={currency}
                canViewMargin={canViewMargin}
                editable={editable}
                onChange={(patch) => updateItem(item.clientId, patch)}
                onRemove={() => removeItem(item.clientId)}
                onApproveBelowCost={onApproveBelowCost ? () => onApproveBelowCost(item) : undefined}
                approvingBelowCost={approvingItemId === item.clientId}
                canApproveBelowCost={canApproveBelowCost}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {editable && (
        <Button type="button" variant="outline" size="sm" onClick={addItem}>
          <Plus className="mr-2 h-4 w-4" />
          {t('addItem')}
        </Button>
      )}
    </div>
  );
}

