import {
  parseDecimalString,
  parseDecimalStringOrZero,
  parseIntOrUndefined,
  parseLegacyDate,
  parseLegacyBoolean,
  parseOptionalString,
  parseRequiredString,
} from './parsing';

describe('parseDecimalString', () => {
  it('parses a numeric cell to its string form', () => {
    expect(parseDecimalString(12.5)).toBe('12.5');
    expect(parseDecimalString('7')).toBe('7');
  });
  it('returns undefined for blank or non-numeric input, never a silent 0', () => {
    expect(parseDecimalString('')).toBeUndefined();
    expect(parseDecimalString(null)).toBeUndefined();
    expect(parseDecimalString(undefined)).toBeUndefined();
    expect(parseDecimalString('n/a')).toBeUndefined();
  });
});

describe('parseDecimalStringOrZero', () => {
  it('falls back to "0" and flags wasBlank for unparseable input', () => {
    expect(parseDecimalStringOrZero('')).toEqual({ value: '0', wasBlank: true });
    expect(parseDecimalStringOrZero(null)).toEqual({ value: '0', wasBlank: true });
  });
  it('parses a real value without flagging it blank', () => {
    expect(parseDecimalStringOrZero(3)).toEqual({ value: '3', wasBlank: false });
  });
});

describe('parseIntOrUndefined', () => {
  it('truncates a float to an integer', () => {
    expect(parseIntOrUndefined(4.9)).toBe(4);
  });
  it('returns undefined for blank input', () => {
    expect(parseIntOrUndefined('')).toBeUndefined();
    expect(parseIntOrUndefined(null)).toBeUndefined();
  });
});

describe('parseLegacyDate', () => {
  it('parses a real date string', () => {
    const result = parseLegacyDate('2025-01-15 10:30:00');
    expect(result).toBeInstanceOf(Date);
    expect(result?.getFullYear()).toBe(2025);
  });
  it('passes a real Date value through unchanged', () => {
    const d = new Date('2024-06-01');
    expect(parseLegacyDate(d)).toBe(d);
  });
  it('returns undefined (never "now") for blank or unparseable input', () => {
    expect(parseLegacyDate('')).toBeUndefined();
    expect(parseLegacyDate(null)).toBeUndefined();
    expect(parseLegacyDate('not a date')).toBeUndefined();
  });
});

describe('parseLegacyBoolean', () => {
  it('accepts real booleans, numbers, and common string variants', () => {
    expect(parseLegacyBoolean(true)).toBe(true);
    expect(parseLegacyBoolean(false)).toBe(false);
    expect(parseLegacyBoolean(1)).toBe(true);
    expect(parseLegacyBoolean(0)).toBe(false);
    expect(parseLegacyBoolean('TRUE')).toBe(true);
    expect(parseLegacyBoolean('так')).toBe(true);
    expect(parseLegacyBoolean('ні')).toBe(false);
  });
  it('defaults to false for null/undefined/unrecognized', () => {
    expect(parseLegacyBoolean(null)).toBe(false);
    expect(parseLegacyBoolean(undefined)).toBe(false);
    expect(parseLegacyBoolean('maybe')).toBe(false);
  });
});

describe('parseOptionalString', () => {
  it('trims and returns non-empty strings', () => {
    expect(parseOptionalString('  hello  ')).toBe('hello');
  });
  it('returns null (never empty string) for blank input', () => {
    expect(parseOptionalString('')).toBeNull();
    expect(parseOptionalString('   ')).toBeNull();
    expect(parseOptionalString(null)).toBeNull();
    expect(parseOptionalString(undefined)).toBeNull();
  });
});

describe('parseRequiredString', () => {
  it('uses the real value when present', () => {
    expect(parseRequiredString('Real Name', 'fallback')).toEqual({ value: 'Real Name', wasBlank: false });
  });
  it('falls back and flags wasBlank when the cell is empty', () => {
    expect(parseRequiredString('', 'fallback')).toEqual({ value: 'fallback', wasBlank: true });
    expect(parseRequiredString(null, 'fallback')).toEqual({ value: 'fallback', wasBlank: true });
  });
});
