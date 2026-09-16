import { cn, formatEur, formatEurWithUah } from './utils';

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

describe('formatEurWithUah', () => {
  it('rounds the hryvnia figure UP to the nearest 100 (2026-09-16 user request — "у ширинга іллі 38623 грн... щоб було 38700")', () => {
    expect(formatEurWithUah(1000, 38.623)).toBe('1000.00 € (38700 ₴)');
  });

  it('leaves an already-round-hundred amount untouched — never rounds down', () => {
    expect(formatEurWithUah(1000, 38.6)).toBe('1000.00 € (38600 ₴)');
  });

  it('returns plain EUR when no rate has been entered', () => {
    expect(formatEurWithUah(1000, null)).toBe('1000.00 €');
    expect(formatEurWithUah(1000, 0)).toBe('1000.00 €');
  });
});
