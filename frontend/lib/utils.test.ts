import { cn, formatEur, formatUah, formatUahExact, uahRoundUp } from './utils';

describe('cn', () => {
  it('merges class lists', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('drops falsy values', () => {
    expect(cn('a', false, undefined, null, 'b')).toBe('a b');
  });

  it('dedupes conflicting Tailwind utility classes, keeping the last one', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });

  it('supports conditional object syntax', () => {
    expect(cn('base', { active: true, hidden: false })).toBe('base active');
  });
});

describe('formatEur', () => {
  it('formats to 2 decimals with a trailing € mark', () => {
    expect(formatEur(1234.5)).toBe('1234.50 €');
  });

  it('rounds to 2 decimals', () => {
    expect(formatEur(1.005)).toBe('1.00 €'); // matches Number.prototype.toFixed's own (imprecise) rounding, not a bug to fix here
  });
});

describe('uahRoundUp', () => {
  it('rounds UP to the nearest 100 (2026-09-16 user request — "у ширинга іллі 38623 грн... щоб було 38700")', () => {
    expect(uahRoundUp(1000, 38.623)).toBe(38700);
  });

  it('leaves an already-round-hundred amount untouched — never rounds down', () => {
    expect(uahRoundUp(1000, 38.6)).toBe(38600);
  });

  it('returns null (not a fabricated 0) when no rate has been entered', () => {
    expect(uahRoundUp(1000, null)).toBeNull();
    expect(uahRoundUp(1000, 0)).toBeNull();
  });

  it('summing each employee\'s own rounded-up UAH differs from rounding the combined EUR total once (2026-09-16 user follow-up — "загалом по всіх... має додатися гривнева сума по працівниках")', () => {
    // Two employees each earning 2601 (rate 1): individually rounded up to
    // 2700 apiece -> real cash paid out sums to 5400. Rounding their
    // COMBINED total (5202) once instead gives only 5300 — the wrong
    // grand total, since it understates what was actually paid out.
    const rate = 1;
    const sumOfPerEmployee = uahRoundUp(2601, rate)! + uahRoundUp(2601, rate)!;
    const roundedCombinedOnce = uahRoundUp(2601 + 2601, rate)!;

    expect(sumOfPerEmployee).toBe(5400);
    expect(roundedCombinedOnce).toBe(5300);
    expect(sumOfPerEmployee).not.toBe(roundedCombinedOnce);
  });
});

describe('formatUahExact', () => {
  it('shows the exact UAH equivalent ONLY (2026-09-18 — "якщо вводимо курс євро то для друку відображатимуться тільки гривні"), NOT rounded up to the nearest 100 — a per-unit BOM cost is nothing like a payroll payout', () => {
    expect(formatUahExact(45.05, 40)).toBe('1802.00 ₴');
  });

  it('falls back to plain EUR when no rate has been entered', () => {
    expect(formatUahExact(45.05, null)).toBe('45.05 €');
    expect(formatUahExact(45.05, 0)).toBe('45.05 €');
  });
});
