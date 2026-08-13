import { cn, formatEur } from './utils';

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
