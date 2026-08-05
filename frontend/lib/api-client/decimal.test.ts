import { toNumber, toDecimalInput } from './decimal';

describe('toNumber', () => {
  it('parses a Prisma Decimal string into a number', () => {
    expect(toNumber('12.500')).toBe(12.5);
  });

  it('returns null for null/undefined/empty', () => {
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
    expect(toNumber('')).toBeNull();
  });

  it('returns null for a non-numeric string rather than NaN', () => {
    expect(toNumber('not-a-number')).toBeNull();
  });
});

describe('toDecimalInput', () => {
  it('passes a valid number through', () => {
    expect(toDecimalInput(42)).toBe(42);
  });

  it('converts null/undefined/NaN to undefined (omit the field, not send 0)', () => {
    expect(toDecimalInput(null)).toBeUndefined();
    expect(toDecimalInput(undefined)).toBeUndefined();
    expect(toDecimalInput(NaN)).toBeUndefined();
  });
});
