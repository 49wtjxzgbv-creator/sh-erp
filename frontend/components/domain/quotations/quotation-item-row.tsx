'use client';

import { useTranslations } from 'next-intl';
import { GripVertical, Trash2 } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAssembly, useAssemblyCost } from '@/lib/hooks/use-bom';
import { useProduct } from '@/lib/hooks/use-catalog';
import { toNumber } from '@/lib/api-client/decimal';
import { formatMoney } from '@/lib/finance-format';
import type { QuotationItemKind, PricingSource } from '@/lib/api-client/quotations';
import { AssemblyPicker } from '@/components/domain/bom/assembly-picker';
import { ProductPicker } from '@/components/domain/catalog/product-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { PricingMethodField, computeLivePrice } from './pricing-method-field';

export interface QuotationItemDraft {
  /** Stable client-side key — the real server item id for an already-saved line, a generated one for a newly-added line not yet saved. Used only for React keys/dnd-kit, never sent to the server. */
  clientId: string;
  /** Set only for an already-saved line — needed for approveBelowCost, which acts on the real item id. */
  serverItemId?: string;
  kind: QuotationItemKind;
  assemblyId?: string;
  productId?: string;
  entityLabel?: string;
  nameSnapshot?: string;
  descriptionSnapshot?: string;
  quantity: number;
  unit: string;
  pricingSource: PricingSource;
  pricingPercent?: number;
  customUnitPrice?: number;
  discountPercent?: number;
  belowCostApproved: boolean;
}

const ITEM_KINDS: QuotationItemKind[] = ['ASSEMBLY', 'PRODUCT', 'SERVICE', 'DELIVERY', 'INSTALLATION', 'CUSTOM'];

function allowedSourcesForKind(kind: QuotationItemKind): PricingSource[] {
  if (kind === 'ASSEMBLY') return ['BASE_PRICE', 'MARKUP_PERCENT', 'COST_PLUS_MARGIN', 'LABOR_MARKUP_PERCENT', 'LABOR_COST_PLUS_MARGIN', 'CUSTOM'];
  if (kind === 'PRODUCT') return ['MARKUP_PERCENT', 'COST_PLUS_MARGIN', 'CUSTOM'];
  return ['CUSTOM'];
}

export interface QuotationItemRowProps {
  item: QuotationItemDraft;
  currency: string;
  canViewMargin: boolean;
  editable: boolean;
  onChange: (patch: Partial<QuotationItemDraft>) => void;
  onRemove: () => void;
  onApproveBelowCost?: () => void;
  approvingBelowCost?: boolean;
  canApproveBelowCost: boolean;
}

export function QuotationItemRow({
  item,
  currency,
  canViewMargin,
  editable,
  onChange,
  onRemove,
  onApproveBelowCost,
  approvingBelowCost,
  canApproveBelowCost,
}: QuotationItemRowProps) {
  const t = useTranslations('quotations');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.clientId, disabled: !editable });

  const { data: assembly } = useAssembly(item.kind === 'ASSEMBLY' ? item.assemblyId : undefined);
  const { data: assemblyCost } = useAssemblyCost(item.kind === 'ASSEMBLY' ? item.assemblyId : undefined);
  const { data: product } = useProduct(item.kind === 'PRODUCT' ? item.productId : undefined);

  const cost = item.kind === 'ASSEMBLY' ? assemblyCost?.costPerUnit ?? null : item.kind === 'PRODUCT' ? toNumber(product?.sellPriceEur) : null;
  const basePrice = item.kind === 'ASSEMBLY' ? toNumber(assembly?.baseSalePriceEur ?? null) : null;
  const laborCost = item.kind === 'ASSEMBLY' ? toNumber(assembly?.laborCostPerUnit ?? null) : null;
  // Existence of the id (not the display label) is what actually matters —
  // `entityLabel` is only ever populated by the picker's own onChange, so an
  // ASSEMBLY/PRODUCT line hydrated fresh from a saved quotation would show
  // a false "name required" warning if this checked the label instead.
  const hasTarget = item.kind === 'ASSEMBLY' ? Boolean(item.assemblyId) : item.kind === 'PRODUCT' ? Boolean(item.productId) : Boolean(item.nameSnapshot);

  const livePrice = computeLivePrice(item.pricingSource, cost, basePrice, item.pricingPercent, item.customUnitPrice, laborCost);
  const subtotal = livePrice !== null ? livePrice * item.quantity : null;
  const discountAmount = subtotal !== null ? subtotal * ((item.discountPercent ?? 0) / 100) : null;
  const lineTotal = subtotal !== null && discountAmount !== null ? subtotal - discountAmount : null;
  const isBelowCost = cost !== null && lineTotal !== null && lineTotal < cost * item.quantity;

  function handleKindChange(kind: QuotationItemKind) {
    const allowed = allowedSourcesForKind(kind);
    onChange({
      kind,
      assemblyId: undefined,
      productId: undefined,
      entityLabel: undefined,
      nameSnapshot: undefined,
      pricingSource: allowed.includes(item.pricingSource) ? item.pricingSource : 'CUSTOM',
    });
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-md border p-3 ${isDragging ? 'opacity-60' : ''} ${isBelowCost ? 'border-destructive/50' : 'border-border'}`}
    >
      <div className="flex items-start gap-2">
        {editable && (
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="mt-1.5 shrink-0 cursor-grab touch-none rounded p-1 text-muted-foreground hover:text-foreground active:cursor-grabbing"
            aria-label={t('reorderItem')}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}
        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1.5">
            <Select value={item.kind} onValueChange={(v) => handleKindChange(v as QuotationItemKind)} disabled={!editable}>
              <SelectTrigger className="h-8 w-full text-xs sm:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ITEM_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`itemKind${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {item.kind === 'ASSEMBLY' && (
              <AssemblyPicker
                value={item.assemblyId}
                onChange={(id, label) => onChange({ assemblyId: id, entityLabel: label })}
                placeholder={t('pickAssembly')}
              />
            )}
            {item.kind === 'PRODUCT' && (
              <ProductPicker
                value={item.productId}
                onChange={(id, label) => onChange({ productId: id, entityLabel: label })}
                placeholder={t('pickProduct')}
              />
            )}
            {(item.kind === 'SERVICE' || item.kind === 'DELIVERY' || item.kind === 'INSTALLATION' || item.kind === 'CUSTOM') && (
              <Input
                placeholder={t('itemName')}
                value={item.nameSnapshot ?? ''}
                disabled={!editable}
                onChange={(e) => onChange({ nameSnapshot: e.target.value })}
                className="h-8 max-w-sm text-xs"
              />
            )}
            {!hasTarget && <p className="text-xs text-destructive">{t('itemNameRequired')}</p>}

            <Input
              placeholder={t('itemDescription')}
              value={item.descriptionSnapshot ?? ''}
              disabled={!editable}
              onChange={(e) => onChange({ descriptionSnapshot: e.target.value })}
              className="h-7 max-w-sm text-xs text-muted-foreground"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-2 rounded-md border border-border/70 p-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <Label className="w-16 text-xs text-muted-foreground">{t('qty')}</Label>
                <Input
                  type="number"
                  step="0.001"
                  min={0.001}
                  value={item.quantity}
                  disabled={!editable}
                  onChange={(e) => onChange({ quantity: Number(e.target.value) })}
                  className="h-8 w-24 text-xs"
                />
                <Input
                  value={item.unit}
                  disabled={!editable}
                  onChange={(e) => onChange({ unit: e.target.value })}
                  className="h-8 w-16 text-xs"
                />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Label className="w-16 text-xs text-muted-foreground">{t('discountPercent')}</Label>
                <Input
                  type="number"
                  step="0.1"
                  min={0}
                  max={100}
                  value={item.discountPercent ?? ''}
                  disabled={!editable}
                  onChange={(e) => onChange({ discountPercent: e.target.value === '' ? undefined : Number(e.target.value) })}
                  className="h-8 w-24 text-xs"
                />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
            </div>

            <div className="space-y-1.5 rounded-md border border-border/70 bg-muted/20 p-2.5">
              <Label className="text-xs text-muted-foreground">{t('pricingMethod')}</Label>
              <PricingMethodField
                pricingSource={item.pricingSource}
                pricingPercent={item.pricingPercent}
                customUnitPrice={item.customUnitPrice}
                cost={cost}
                basePrice={basePrice}
                laborCost={laborCost}
                currency={currency}
                canViewMargin={canViewMargin}
                disabled={!editable}
                allowedSources={allowedSourcesForKind(item.kind)}
                assemblyId={item.kind === 'ASSEMBLY' ? item.assemblyId : undefined}
                onChange={onChange}
              />
              <p className="text-sm font-semibold">
                {t('lineTotal')}: {lineTotal !== null ? formatMoney(lineTotal, currency) : '—'}
              </p>
              {isBelowCost && (
                <div className="flex flex-wrap items-center gap-2">
                  {item.belowCostApproved ? (
                    <Badge variant="warning">{t('belowCostApproved')}</Badge>
                  ) : (
                    <>
                      <Badge variant="destructive">{t('belowCostNotApproved')}</Badge>
                      {canApproveBelowCost && item.serverItemId && onApproveBelowCost && (
                        <Button size="sm" variant="outline" className="h-6 px-2 text-xs" loading={approvingBelowCost} onClick={onApproveBelowCost}>
                          {t('approveBelowCost')}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        {editable && (
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive" onClick={onRemove}>
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
