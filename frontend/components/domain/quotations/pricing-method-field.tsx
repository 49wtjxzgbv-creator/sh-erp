'use client';

import Link from 'next/link';
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
  laborCost: number | null = null,
  germanPriceInclVat: number | null = null,
  germanPrice: number | null = null,
  germanPriceMarkupAmount: number | undefined = undefined,
): number | null {
  switch (pricingSource) {
    case 'BASE_PRICE':
      return basePrice ?? null;
    case 'GERMAN_PRICE_INCL_VAT':
      return germanPriceInclVat ?? null;
    case 'GERMAN_PRICE': {
      if (germanPrice === null) return null;
      // "додай можливість у комерційній пропозиції також давати націнку на
      // Ціна виробу в Німеччині, € чи відсотками чи конкретною сумою"
      // (2026-10-15) — mirrors the backend's own precedence exactly (see
      // quotation-pricing.service.ts's GERMAN_PRICE case).
      if (germanPriceMarkupAmount !== undefined) return round2(germanPrice + germanPriceMarkupAmount);
      if (pricingPercent !== undefined) return round2(germanPrice * (1 + pricingPercent / 100));
      return germanPrice;
    }
    case 'MARKUP_PERCENT':
      return cost !== null && pricingPercent !== undefined ? round2(cost * (1 + pricingPercent / 100)) : null;
    case 'COST_PLUS_MARGIN':
      return cost !== null && pricingPercent !== undefined && pricingPercent < 100 ? round2(cost / (1 - pricingPercent / 100)) : null;
    case 'LABOR_MARKUP_PERCENT':
      return laborCost !== null && pricingPercent !== undefined ? round2(laborCost * (1 + pricingPercent / 100)) : null;
    case 'LABOR_COST_PLUS_MARGIN':
      return laborCost !== null && pricingPercent !== undefined && pricingPercent < 100 ? round2(laborCost / (1 - pricingPercent / 100)) : null;
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
  /** Assembly.laborCostPerUnit — the basis for LABOR_MARKUP_PERCENT/LABOR_COST_PLUS_MARGIN. Unlike `cost`, never "unknown" for a real ASSEMBLY item (defaults to 0); null means "not applicable" (non-ASSEMBLY kind). */
  laborCost: number | null;
  /** Product.germanPriceInclVat — the basis for GERMAN_PRICE_INCL_VAT, taken as-is (already VAT-inclusive, per that field's own "з ПДВ" label). null means "not set" (PRODUCT with no German price) or "not applicable" (non-PRODUCT kind). */
  germanPriceInclVat: number | null;
  /** Assembly.germanPriceEur — the basis for GERMAN_PRICE, taken as-is, plain (no VAT claim at all, unlike germanPriceInclVat above). null means "not set" (ASSEMBLY with no German price) or "not applicable" (non-ASSEMBLY kind). */
  germanPrice: number | null;
  /** GERMAN_PRICE only — optional fixed €-amount markup on top of germanPrice, wins over pricingPercent when both are set (same "explicit override wins" precedence as discount's own percent/amount pair). undefined = not using the amount mode (may still be using pricingPercent, or no markup at all). */
  germanPriceMarkupAmount: number | undefined;
  currency: string;
  canViewMargin: boolean;
  disabled?: boolean;
  /** Which methods make sense for this item's kind — BASE_PRICE only exists for ASSEMBLY (Assembly.baseSalePriceEur), MARKUP_PERCENT/COST_PLUS_MARGIN need a cost basis (ASSEMBLY/PRODUCT only) — see this file's own header comment. */
  allowedSources: PricingSource[];
  /** Only present for kind=ASSEMBLY — lets the "no base price set"/"no German price set" (GERMAN_PRICE) warnings link straight to where a manager can actually go set it. */
  assemblyId?: string;
  /** Only present for kind=PRODUCT — same purpose as assemblyId above, for the "no German price set" warning (GERMAN_PRICE_INCL_VAT). */
  productId?: string;
  onChange: (patch: { pricingSource?: PricingSource; pricingPercent?: number; germanPriceMarkupAmount?: number; customUnitPrice?: number }) => void;
}

const ALL_SOURCES: PricingSource[] = [
  'BASE_PRICE',
  'MARKUP_PERCENT',
  'COST_PLUS_MARGIN',
  'LABOR_MARKUP_PERCENT',
  'LABOR_COST_PLUS_MARGIN',
  'CUSTOM',
  'GERMAN_PRICE_INCL_VAT',
  'GERMAN_PRICE',
];

export function PricingMethodField({
  pricingSource,
  pricingPercent,
  customUnitPrice,
  cost,
  basePrice,
  laborCost,
  germanPriceInclVat,
  germanPrice,
  germanPriceMarkupAmount,
  currency,
  canViewMargin,
  disabled,
  allowedSources,
  assemblyId,
  productId,
  onChange,
}: PricingMethodFieldProps) {
  const t = useTranslations('quotations');
  const livePrice = computeLivePrice(
    pricingSource,
    cost,
    basePrice,
    pricingPercent,
    customUnitPrice,
    laborCost,
    germanPriceInclVat,
    germanPrice,
    germanPriceMarkupAmount,
  );
  const markupMode: 'percent' | 'amount' = germanPriceMarkupAmount !== undefined ? 'amount' : 'percent';
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
      <p className="text-[11px] leading-snug text-muted-foreground">{t(`pricingSource${pricingSource}Explanation`)}</p>

      {pricingSource === 'BASE_PRICE' && (
        basePrice !== null ? (
          <p className="text-xs text-muted-foreground">{t('basePriceIs')}: {formatMoney(basePrice, currency)}</p>
        ) : (
          <div className="space-y-0.5">
            <p className="text-xs text-destructive">{t('noBasePriceWarning')}</p>
            {assemblyId && (
              <Link href={`/bom/${assemblyId}`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
                {t('setBasePriceLink')}
              </Link>
            )}
          </div>
        )
      )}

      {pricingSource === 'GERMAN_PRICE_INCL_VAT' && (
        germanPriceInclVat !== null ? (
          <p className="text-xs text-muted-foreground">{t('germanPriceIs')}: {formatMoney(germanPriceInclVat, currency)}</p>
        ) : (
          <div className="space-y-0.5">
            <p className="text-xs text-destructive">{t('noGermanPriceWarning')}</p>
            {productId && (
              <Link href={`/catalog/${productId}`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
                {t('setGermanPriceLink')}
              </Link>
            )}
          </div>
        )
      )}

      {pricingSource === 'GERMAN_PRICE' && (
        germanPrice !== null ? (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">{t('germanPriceAssemblyIs')}: {formatMoney(germanPrice, currency)}</p>
            {/* "додай можливість у комерційній пропозиції також давати
                націнку на Ціна виробу в Німеччині, € чи відсотками чи
                конкретною сумою" (2026-10-15) — optional, neither mode
                required; switching modes clears the other field so a
                stale value never silently re-activates. */}
            <div className="flex items-center gap-1.5">
              <div className="inline-flex overflow-hidden rounded-md border border-input text-xs">
                <button
                  type="button"
                  disabled={disabled}
                  className={`px-2 py-1 ${markupMode === 'percent' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                  onClick={() => onChange({ germanPriceMarkupAmount: undefined })}
                >
                  %
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  className={`border-l border-input px-2 py-1 ${markupMode === 'amount' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                  onClick={() => onChange({ germanPriceMarkupAmount: germanPriceMarkupAmount ?? 0, pricingPercent: undefined })}
                >
                  {currency}
                </button>
              </div>
              <Input
                type="number"
                step={markupMode === 'percent' ? '0.1' : '0.01'}
                className="h-8 w-24 text-xs"
                value={(markupMode === 'percent' ? pricingPercent : germanPriceMarkupAmount) ?? ''}
                disabled={disabled}
                onChange={(e) => {
                  const v = e.target.value === '' ? undefined : Number(e.target.value);
                  if (markupMode === 'percent') onChange({ pricingPercent: v });
                  else onChange({ germanPriceMarkupAmount: v });
                }}
              />
              <span className="text-xs text-muted-foreground">{t('germanPriceMarkupHint')}</span>
            </div>
          </div>
        ) : (
          <div className="space-y-0.5">
            <p className="text-xs text-destructive">{t('noGermanPriceAssemblyWarning')}</p>
            {assemblyId && (
              <Link href={`/bom/${assemblyId}`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
                {t('setGermanPriceAssemblyLink')}
              </Link>
            )}
          </div>
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

      {(pricingSource === 'LABOR_MARKUP_PERCENT' || pricingSource === 'LABOR_COST_PLUS_MARGIN') && (
        <div className="flex items-center gap-1.5">
          <Input
            type="number"
            step="0.1"
            min={0}
            max={pricingSource === 'LABOR_COST_PLUS_MARGIN' ? 99.9 : undefined}
            className="h-8 w-20 text-xs"
            value={pricingPercent ?? ''}
            disabled={disabled}
            onChange={(e) => onChange({ pricingPercent: e.target.value === '' ? undefined : Number(e.target.value) })}
          />
          <span className="text-xs text-muted-foreground">%</span>
          {canViewMargin && laborCost !== null && <span className="text-xs text-muted-foreground">{t('laborCostLabel')}: {formatMoney(laborCost, currency)}</span>}
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
