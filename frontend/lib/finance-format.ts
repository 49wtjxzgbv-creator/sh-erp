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

/**
 * Multi-currency module (2026-10-29) — client-side mirror of
 * ExchangeRatesService#convert's UAH-bridge math (backend/src/modules/
 * finance/exchange-rates.service.ts), for live preview widgets that know a
 * row's own currency differs from the target display currency (e.g. a
 * Quotation priced in USD showing an assembly whose own `currency` is EUR)
 * but can't round-trip to the server on every keystroke. `ratesToUah` is
 * `{ [currency]: 1 <currency> = X UAH }`, from `useCurrencyRatesMap` below.
 * Returns `null` — never a silently-wrong number — when a needed rate
 * hasn't loaded yet or doesn't exist, same "never assume rate=1" discipline
 * as the backend.
 */
export function convertWithRates(amount: number, from: string, to: string, ratesToUah: Record<string, number | undefined>): number | null {
  if (from === to) return amount;
  const fromRate = from === 'UAH' ? 1 : ratesToUah[from];
  if (fromRate === undefined) return null;
  const amountInUah = amount * fromRate;
  if (to === 'UAH') return amountInUah;
  const toRate = ratesToUah[to];
  if (toRate === undefined) return null;
  return amountInUah / toRate;
}
