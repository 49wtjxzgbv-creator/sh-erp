import { convertWithRates } from './finance-format';

describe('convertWithRates', () => {
  it('returns the amount unchanged when from === to, even with no rates at all', () => {
    expect(convertWithRates(100, 'USD', 'USD', {})).toBe(100);
  });

  it('converts a non-UAH currency to UAH using its own rate', () => {
    // 1 EUR = 50 UAH
    expect(convertWithRates(10, 'EUR', 'UAH', { EUR: 50 })).toBe(500);
  });

  it('converts UAH to a non-UAH currency by dividing by its rate', () => {
    expect(convertWithRates(500, 'UAH', 'EUR', { EUR: 50 })).toBe(10);
  });

  it('bridges two non-UAH currencies through UAH', () => {
    // 1 EUR = 50 UAH, 1 USD = 40 UAH -> 10 EUR = 500 UAH = 12.5 USD
    expect(convertWithRates(10, 'EUR', 'USD', { EUR: 50, USD: 40 })).toBe(12.5);
  });

  it('returns null (never a silently-wrong number) when the from-rate is missing', () => {
    expect(convertWithRates(10, 'EUR', 'USD', { USD: 40 })).toBeNull();
  });

  it('returns null when the to-rate is missing', () => {
    expect(convertWithRates(10, 'EUR', 'USD', { EUR: 50 })).toBeNull();
  });
});
