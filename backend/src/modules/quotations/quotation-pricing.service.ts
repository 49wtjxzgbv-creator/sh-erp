import { Injectable } from '@nestjs/common';
import { PricingSource } from '@prisma/client';
import { CodedBadRequestException } from '../../common/api-exceptions';

export interface ComputeItemPricingInput {
  pricingSource: PricingSource;
  quantity: number;
  /** Assembly.baseSalePriceEur (or Product's, once/if products ever get one) at the moment of pricing — required only for BASE_PRICE. */
  basePrice: number | null;
  /** costSnapshot — required for MARKUP_PERCENT and COST_PLUS_MARGIN. Never required for BASE_PRICE/CUSTOM, but still carried through for the belowCost check below when known. */
  cost: number | null;
  /** Assembly.laborCostPerUnit — required for LABOR_MARKUP_PERCENT/LABOR_COST_PLUS_MARGIN. Unlike `cost`, this is never "unknown" for a real ASSEMBLY line (the field defaults to 0, not unset) — null here means "not applicable" (kind other than ASSEMBLY, which has no labor-cost concept). */
  laborCost: number | null;
  /** The % entered for MARKUP_PERCENT or COST_PLUS_MARGIN — same field, disambiguated by pricingSource (see this service's own header comment for why these two formulas must never be conflated). */
  pricingPercent: number | null;
  /** The manually-entered price for CUSTOM. */
  customUnitPrice: number | null;
  discountPercent: number;
  /** Explicit absolute override — when set, wins over discountPercent (supports an "enter €X off" workflow alongside "enter Y% off"; the resolved number is what's stored either way, see QuotationVersionItem.discountAmount's own schema comment). */
  discountAmountOverride: number | null;
}

export interface ComputedItemPricing {
  unitPrice: number;
  subtotal: number;
  discountAmount: number;
  total: number;
  /** True when the price actually charged (after discount) is below cost — the UI's warning is keyed on this; it does NOT block anything itself, see belowCostApproved on QuotationVersionItem. False whenever cost is unknown (nothing to compare against). */
  isBelowCost: boolean;
}

/**
 * Pure pricing math — no Prisma, no side effects, fully unit-testable in
 * isolation. Deliberately kept separate from QuotationsService (which owns
 * persistence/snapshotting) so the arithmetic itself — the part most likely
 * to be gotten subtly wrong and hardest to spot in review once buried in a
 * bigger method — has nothing else to distract from it.
 *
 * The six pricing methods (explicit user decision, 2026-08-27; the two
 * LABOR_* methods added 2026-08-28):
 *   BASE_PRICE:              unitPrice = basePrice, unchanged
 *   MARKUP_PERCENT:          unitPrice = cost × (1 + p/100)            — e.g. 25% ⇒ cost × 1.25
 *   COST_PLUS_MARGIN:        unitPrice = cost / (1 - p/100)            — e.g. 25% ⇒ cost / 0.75
 *   LABOR_MARKUP_PERCENT:    unitPrice = laborCost × (1 + p/100)       — same formula as MARKUP_PERCENT, labor cost only
 *   LABOR_COST_PLUS_MARGIN:  unitPrice = laborCost / (1 - p/100)       — same formula as COST_PLUS_MARGIN, labor cost only
 *   CUSTOM:                  unitPrice = customUnitPrice, as entered
 *
 * MARKUP_PERCENT and COST_PLUS_MARGIN are NOT interchangeable — a markup
 * multiplies cost up; a margin target divides cost by the fraction of
 * revenue that ISN'T cost, which is a strictly larger number for the same
 * percent (25% markup on €8000 is €10000; 25% margin on €8000 is
 * €10666.67, since €8000 must be exactly 75% of the resulting price, not
 * 80%). Same relationship holds between the two LABOR_* variants. All four
 * markup/margin methods key off `cost` or `laborCost`, never `basePrice` —
 * only BASE_PRICE ever reads basePrice. The below-cost check further down
 * always compares against the FULL assembly cost regardless of which
 * method priced the line — pricing off labor content alone must never
 * silently hide a sale that doesn't even cover materials.
 *
 * Discount is applied AFTER the pricing formula produces unitPrice, never
 * folded into it (§5 requirement) — subtotal = unitPrice × quantity is the
 * "ціна до знижки" figure the UI shows, discountAmount is subtracted from
 * that to reach `total`, the "фінальна ціна" line total.
 */
@Injectable()
export class QuotationPricingService {
  computeItemPricing(input: ComputeItemPricingInput): ComputedItemPricing {
    if (input.quantity <= 0) {
      throw new CodedBadRequestException('QUOTATION_ITEM_INVALID_QUANTITY', 'Quantity must be greater than zero.');
    }
    if (input.discountPercent < 0 || input.discountPercent > 100) {
      throw new CodedBadRequestException('QUOTATION_ITEM_INVALID_DISCOUNT', 'Discount percent must be between 0 and 100.');
    }

    const unitPrice = this.resolveUnitPrice(input);
    if (unitPrice < 0) {
      throw new CodedBadRequestException('QUOTATION_ITEM_NEGATIVE_PRICE', 'Resolved unit price cannot be negative.');
    }

    const subtotal = round2(unitPrice * input.quantity);
    const discountAmount =
      input.discountAmountOverride !== null ? round2(input.discountAmountOverride) : round2(subtotal * (input.discountPercent / 100));
    if (discountAmount < 0 || discountAmount > subtotal) {
      throw new CodedBadRequestException('QUOTATION_ITEM_INVALID_DISCOUNT_AMOUNT', 'Discount amount must be between 0 and the line subtotal.');
    }
    const total = round2(subtotal - discountAmount);

    const isBelowCost = input.cost !== null && total < round2(input.cost * input.quantity);

    return { unitPrice, subtotal, discountAmount, total, isBelowCost };
  }

  private resolveUnitPrice(input: ComputeItemPricingInput): number {
    switch (input.pricingSource) {
      case 'BASE_PRICE': {
        if (input.basePrice === null) {
          throw new CodedBadRequestException(
            'QUOTATION_ITEM_NO_BASE_PRICE',
            'This assembly has no base sale price set — choose "Собівартість + маржа" or "Власна ціна" instead.',
          );
        }
        return round2(input.basePrice);
      }
      case 'MARKUP_PERCENT': {
        this.requireCostAndPercent(input);
        return round2(input.cost! * (1 + input.pricingPercent! / 100));
      }
      case 'COST_PLUS_MARGIN': {
        this.requireCostAndPercent(input);
        if (input.pricingPercent! >= 100) {
          throw new CodedBadRequestException('QUOTATION_ITEM_MARGIN_TOO_HIGH', 'Margin percent must be less than 100 — a 100%+ margin implies an infinite or negative price.');
        }
        return round2(input.cost! / (1 - input.pricingPercent! / 100));
      }
      case 'LABOR_MARKUP_PERCENT': {
        this.requireLaborCostAndPercent(input);
        return round2(input.laborCost! * (1 + input.pricingPercent! / 100));
      }
      case 'LABOR_COST_PLUS_MARGIN': {
        this.requireLaborCostAndPercent(input);
        if (input.pricingPercent! >= 100) {
          throw new CodedBadRequestException('QUOTATION_ITEM_MARGIN_TOO_HIGH', 'Margin percent must be less than 100 — a 100%+ margin implies an infinite or negative price.');
        }
        return round2(input.laborCost! / (1 - input.pricingPercent! / 100));
      }
      case 'CUSTOM': {
        if (input.customUnitPrice === null) {
          throw new CodedBadRequestException('QUOTATION_ITEM_NO_CUSTOM_PRICE', 'Custom pricing was selected but no price was entered.');
        }
        return round2(input.customUnitPrice);
      }
    }
  }

  private requireCostAndPercent(input: ComputeItemPricingInput): void {
    if (input.cost === null) {
      throw new CodedBadRequestException('QUOTATION_ITEM_NO_COST', 'This line has no known cost — markup/margin pricing needs a cost basis.');
    }
    if (input.pricingPercent === null) {
      throw new CodedBadRequestException('QUOTATION_ITEM_NO_PRICING_PERCENT', 'A percent value is required for this pricing method.');
    }
  }

  private requireLaborCostAndPercent(input: ComputeItemPricingInput): void {
    if (input.laborCost === null) {
      throw new CodedBadRequestException('QUOTATION_ITEM_NO_LABOR_COST', 'This line has no labor cost basis — labor-based pricing only applies to assemblies.');
    }
    if (input.pricingPercent === null) {
      throw new CodedBadRequestException('QUOTATION_ITEM_NO_PRICING_PERCENT', 'A percent value is required for this pricing method.');
    }
  }
}

/** Money is Decimal(14,2) end to end — round consistently at every arithmetic step rather than letting floating-point drift accumulate across subtotal/discount/total. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
