'use client';

import { useTranslations } from 'next-intl';
import type { PricingSource } from '@/lib/api-client/quotations';
import { formatMoney } from '@/lib/finance-format';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

/**
 * §5/§15 of the spec: MARKUP_PERCENT ("націнка на собівартість") and
 * COST_PLUS_MARGIN ("маржа") are DIFFERENT formulas and must never be
 * presented as interchangeable — mirrors
 * backend/src/modules/quotations/quotation-pricing.service.ts EXACTLY
 * (25% markup on €8000 → €10000; 25% margin on €8000 → €10666.67). This
 * client-side copy is display-only (instant feedback while typing) — the
 * server recomputes authoritatively on save and is the only value that
 * actually gets stored.
 */
export function computeLivePrice(
  pricingSource: PricingSource,
  cost: number | null,
  basePrice: number | null,
  pricingPercent: number | undefined,
  customUnitPrice: number | undefined,
): number | null {
  switch (pricingSource) {
    case 'BASE_PRICE':
      return basePrice ?? null;
    case 'MARKUP_PERCENT':
      return cost !== null && pricingPercent !== undefined ? round2(cost * (1 + pricingPercent / 100)) : null;
    case 'COST_PLUS_MARGIN':
      return cost !== null && pricingPercent !== undefined && pricingPercent < 100 ? round2(cost / (1 - pricingPercent / 100)) : null;
    case 'CUSTOM':
      return customUnitPrice ?? null;
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export interface PricingMethodFieldProps {
  pricingSource: PricingSource;
  pricingPercent: number | undefined;
  customUnitPrice: number | undefined;
  /** null = unknown/not resolved yet; also null (hidden) without quotations:view-margin — see this component's own render logic for the distinction via `canViewMargin`. */
  cost: number | null;
  basePrice: number | null;
  currency: string;
  canViewMargin: boolean;
  disabled?: boolean;
  /** Which methods make sense for this item's kind — BASE_PRICE only exists for ASSEMBLY (Assembly.baseSalePriceEur), MARKUP_PERCENT/COST_PLUS_MARGIN need a cost basis (ASSEMBLY/PRODUCT only) — see this file's own header comment. */
  allowedSources: PricingSource[];
  onChange: (patch: { pricingSource?: PricingSource; pricingPercent?: number; customUnitPrice?: number }) => void;
}

const ALL_SOURCES: PricingSource[] = ['BASE_PRICE', 'MARKUP_PERCENT', 'COST_PLUS_MARGIN', 'CUSTOM'];

export function PricingMethodField({
  pricingSource,
  pricingPercent,
  customUnitPrice,
  cost,
  basePrice,
  currency,
  canViewMargin,
  disabled,
  allowedSources,
  onChange,
}: PricingMethodFieldProps) {
  const t = useTranslations('quotations');
  const livePrice = computeLivePrice(pricingSource, cost, basePrice, pricingPercent, customUnitPrice);
  const isBelowCost = canViewMargin && cost !== null && livePrice !== null && livePrice < cost;

  return (
    <div className="space-y-1.5">
      <Select value={pricingSource} onValueChange={(v) => onChange({ pricingSource: v as PricingSource })} disabled={disabled}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ALL_SOURCES.filter((s) => allowedSources.includes(s)).map((s) => (
            <SelectItem key={s} value={s}>
              {t(`pricingSource${s}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {pricingSource === 'BASE_PRICE' && (
        basePrice !== null ? (
          <p className="text-xs text-muted-foreground">{t('basePriceIs')}: {formatMoney(basePrice, currency)}</p>
        ) : (
          <p className="text-xs text-destructive">{t('noBasePriceWarning')}</p>
        )
      )}

      {(pricingSource === 'MARKUP_PERCENT' || pricingSource === 'COST_PLUS_MARGIN') && (
        <div className="flex items-center gap-1.5">
          <Input
            type="number"
            step="0.1"
            min={0}
            max={pricingSource === 'COST_PLUS_MARGIN' ? 99.9 : undefined}
            className="h-8 w-20 text-xs"
            value={pricingPercent ?? ''}
            disabled={disabled}
            onChange={(e) => onChange({ pricingPercent: e.target.value === '' ? undefined : Number(e.target.value) })}
          />
          <span className="text-xs text-muted-foreground">%</span>
          {cost === null && !canViewMargin && <span className="text-xs text-muted-foreground">{t('costHiddenNote')}</span>}
          {cost === null && canViewMargin && <span className="text-xs text-destructive">{t('noCostWarning')}</span>}
        </div>
      )}

      {pricingSource === 'CUSTOM' && (
        <Input
          type="number"
          step="0.01"
          min={0}
          className="h-8 w-28 text-xs"
          value={customUnitPrice ?? ''}
          disabled={disabled}
          onChange={(e) => onChange({ customUnitPrice: e.target.value === '' ? undefined : Number(e.target.value) })}
        />
      )}

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <p className="text-sm font-medium">
          {t('resultingPrice')}: {livePrice !== null ? formatMoney(livePrice, currency) : '—'}
        </p>
        {canViewMargin && cost !== null && <p className="text-xs text-muted-foreground">{t('costLabel')}: {formatMoney(cost, currency)}</p>}
      </div>
      {isBelowCost && <p className="text-xs font-medium text-destructive">{t('belowCostWarning')}</p>}
    </div>
  );
}
