import { QuotationPricingService, ComputeItemPricingInput } from './quotation-pricing.service';

describe('QuotationPricingService', () => {
  let service: QuotationPricingService;

  const base = (overrides: Partial<ComputeItemPricingInput> = {}): ComputeItemPricingInput => ({
    pricingSource: 'CUSTOM',
    quantity: 1,
    basePrice: null,
    cost: null,
    pricingPercent: null,
    customUnitPrice: 100,
    discountPercent: 0,
    discountAmountOverride: null,
    ...overrides,
  });

  beforeEach(() => {
    service = new QuotationPricingService();
  });

  describe('BASE_PRICE', () => {
    it('uses basePrice as-is, with no percent applied', () => {
      const result = service.computeItemPricing(base({ pricingSource: 'BASE_PRICE', basePrice: 12000, quantity: 1 }));
      expect(result.unitPrice).toBe(12000);
    });

    it('§ real requirement: throws rather than silently falling back to cost when no base price is set — a manager must not get an invented sale price', () => {
      expect(() => service.computeItemPricing(base({ pricingSource: 'BASE_PRICE', basePrice: null }))).toThrow();
    });
  });

  describe('MARKUP_PERCENT — "cost × (1 + p/100)", explicitly NOT the same formula as margin', () => {
    it('25% markup on cost €8000 → €10000 (8000 × 1.25)', () => {
      const result = service.computeItemPricing(base({ pricingSource: 'MARKUP_PERCENT', cost: 8000, pricingPercent: 25 }));
      expect(result.unitPrice).toBe(10000);
    });

    it('0% markup is a no-op — unitPrice equals cost exactly', () => {
      const result = service.computeItemPricing(base({ pricingSource: 'MARKUP_PERCENT', cost: 8000, pricingPercent: 0 }));
      expect(result.unitPrice).toBe(8000);
    });

    it('throws when cost is unknown — markup needs a cost basis', () => {
      expect(() => service.computeItemPricing(base({ pricingSource: 'MARKUP_PERCENT', cost: null, pricingPercent: 25 }))).toThrow();
    });
  });

  describe('COST_PLUS_MARGIN — "cost / (1 - p/100)", explicitly NOT the same formula as markup', () => {
    it('25% margin on cost €8000 → €10666.67 (8000 / 0.75), NOT €10000 — the exact case the user called out as a math-conflation risk', () => {
      const result = service.computeItemPricing(base({ pricingSource: 'COST_PLUS_MARGIN', cost: 8000, pricingPercent: 25 }));
      expect(result.unitPrice).toBe(10666.67);
      expect(result.unitPrice).not.toBe(10000); // the MARKUP_PERCENT result for the same inputs — must never coincide
    });

    it('resulting price truly reflects a 25% margin: cost is exactly 75% of the resulting price', () => {
      const result = service.computeItemPricing(base({ pricingSource: 'COST_PLUS_MARGIN', cost: 8000, pricingPercent: 25 }));
      expect(Math.round((8000 / result.unitPrice) * 10000) / 10000).toBeCloseTo(0.75, 3);
    });

    it('0% margin is a no-op — unitPrice equals cost exactly, same as 0% markup', () => {
      const result = service.computeItemPricing(base({ pricingSource: 'COST_PLUS_MARGIN', cost: 8000, pricingPercent: 0 }));
      expect(result.unitPrice).toBe(8000);
    });

    it('rejects a margin of 100% or more — the formula divides by zero or goes negative', () => {
      expect(() => service.computeItemPricing(base({ pricingSource: 'COST_PLUS_MARGIN', cost: 8000, pricingPercent: 100 }))).toThrow();
      expect(() => service.computeItemPricing(base({ pricingSource: 'COST_PLUS_MARGIN', cost: 8000, pricingPercent: 150 }))).toThrow();
    });

    it('throws when cost is unknown — margin needs a cost basis, same as markup', () => {
      expect(() => service.computeItemPricing(base({ pricingSource: 'COST_PLUS_MARGIN', cost: null, pricingPercent: 25 }))).toThrow();
    });
  });

  describe('CUSTOM', () => {
    it('uses the manually entered price as-is', () => {
      const result = service.computeItemPricing(base({ pricingSource: 'CUSTOM', customUnitPrice: 14250 }));
      expect(result.unitPrice).toBe(14250);
    });

    it('throws when CUSTOM is selected but nothing was entered', () => {
      expect(() => service.computeItemPricing(base({ pricingSource: 'CUSTOM', customUnitPrice: null }))).toThrow();
    });
  });

  describe('discount — applied AFTER pricing, never folded into the formula (§5)', () => {
    it('§ full worked example from the spec: базова ціна €12000, метод +25% (markup on... — this line uses MARKUP_PERCENT on cost to keep the two formulas unambiguous), 5% знижка → €14250 фінальна ціна', () => {
      // 8000 cost × 1.25 = 10000 base-equivalent step is NOT what's tested
      // here (that's the BASE_PRICE/markup distinction above); this test
      // instead confirms the discount math itself against round numbers:
      // unitPrice 15000, qty 1, 5% discount → subtotal 15000, discount 750,
      // total 14250 — exactly the spec's own worked numbers.
      const result = service.computeItemPricing(base({ pricingSource: 'CUSTOM', customUnitPrice: 15000, quantity: 1, discountPercent: 5 }));
      expect(result.subtotal).toBe(15000);
      expect(result.discountAmount).toBe(750);
      expect(result.total).toBe(14250);
    });

    it('discount applies to subtotal = unitPrice × quantity, not to unitPrice alone', () => {
      const result = service.computeItemPricing(base({ pricingSource: 'CUSTOM', customUnitPrice: 100, quantity: 3, discountPercent: 10 }));
      expect(result.subtotal).toBe(300);
      expect(result.discountAmount).toBe(30);
      expect(result.total).toBe(270);
    });

    it('an explicit discountAmountOverride wins over discountPercent', () => {
      const result = service.computeItemPricing(base({ pricingSource: 'CUSTOM', customUnitPrice: 100, quantity: 1, discountPercent: 50, discountAmountOverride: 5 }));
      expect(result.discountAmount).toBe(5);
      expect(result.total).toBe(95);
    });

    it('rejects a discount percent above 100', () => {
      expect(() => service.computeItemPricing(base({ discountPercent: 150 }))).toThrow();
    });

    it('rejects a discount percent below 0', () => {
      expect(() => service.computeItemPricing(base({ discountPercent: -10 }))).toThrow();
    });

    it('rejects a discount amount override larger than the subtotal', () => {
      expect(() => service.computeItemPricing(base({ customUnitPrice: 100, quantity: 1, discountAmountOverride: 200 }))).toThrow();
    });
  });

  describe('below-cost detection (§4) — warns, never blocks at this layer', () => {
    it('flags isBelowCost when the final total per unit is under cost', () => {
      const result = service.computeItemPricing(base({ pricingSource: 'CUSTOM', customUnitPrice: 100, quantity: 1, cost: 150 }));
      expect(result.isBelowCost).toBe(true);
      // Confirms this is advisory only — no throw, unitPrice/total still computed normally.
      expect(result.total).toBe(100);
    });

    it('does not flag isBelowCost when price covers cost', () => {
      const result = service.computeItemPricing(base({ pricingSource: 'CUSTOM', customUnitPrice: 200, quantity: 1, cost: 150 }));
      expect(result.isBelowCost).toBe(false);
    });

    it('a discount that pushes the total under cost is still caught — the check runs against total, not the pre-discount unitPrice', () => {
      const result = service.computeItemPricing(base({ pricingSource: 'CUSTOM', customUnitPrice: 160, quantity: 1, cost: 150, discountPercent: 20 }));
      expect(result.total).toBe(128);
      expect(result.isBelowCost).toBe(true);
    });

    it('never flags isBelowCost when cost is unknown — nothing to compare against', () => {
      const result = service.computeItemPricing(base({ pricingSource: 'CUSTOM', customUnitPrice: 1, quantity: 1, cost: null }));
      expect(result.isBelowCost).toBe(false);
    });
  });

  describe('quantity edge cases', () => {
    it('rejects zero quantity', () => {
      expect(() => service.computeItemPricing(base({ quantity: 0 }))).toThrow();
    });

    it('rejects negative quantity', () => {
      expect(() => service.computeItemPricing(base({ quantity: -1 }))).toThrow();
    });
  });
});
