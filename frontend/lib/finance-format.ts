/**
 * Finance module (2026-08-24) is the first corner of this app where a
 * money value isn't implicitly EUR (see `formatEur` in lib/utils.ts, which
 * is deliberately EUR-only — every other amount in the schema has no
 * currency field at all). Kept separate rather than extending `formatEur`.
 */
export function formatMoney(value: number, currency: string): string {
  const amount = value.toFixed(2);
  return currency === 'EUR' ? `${amount} €` : `${amount} ${currency}`;
}
