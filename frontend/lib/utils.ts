import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Standard shadcn/ui helper — merges conditional class lists then dedupes conflicting Tailwind classes. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Every monetary amount in this app is EUR (sellPriceEur is the one price basis everything is pinned to — see assemblies.service.ts) — one shared formatter so the € mark stays consistent everywhere instead of copy-pasted per page. */
export function formatEur(value: number): string {
  return `${value.toFixed(2)} €`;
}

/**
 * Payroll "кількість" (unitsProduced) is a summed Decimal that can pick up
 * real floating-point drift once several PayrollEntry rows are added
 * together server-side (2026-09-16 user report — "виріб касета
 * транспортерів після коми багато значень", real observed values like
 * 2.9999999999996) — every payroll qty display should go through this
 * instead of rendering the raw number. `toFixed(2)` then parsed back to a
 * number so a whole quantity still reads as "3", not "3.00".
 */
export function formatQty(value: number): string {
  return String(Number(value.toFixed(2)));
}

/**
 * "Курс EUR → UAH" (2026-09-16 user request, narrowed twice more the same
 * day — payroll prints' per-employee summary rows show hryvnia INSTEAD OF
 * euro, not alongside it; see order-payroll-print.tsx's own header comment
 * for exactly which rows get this vs. plain `formatEur`), at whatever rate
 * staff typed in via useEurUahRate right before printing. Returns null when
 * no rate is entered (null/0) — never fabricates a conversion that wasn't
 * actually asked for; callers fall back to EUR themselves in that case.
 *
 * Rounded UP to the nearest 100 ("у ширинга іллі 38623 грн...
 * заукруглювало до ста щоб було 38700"), for every employee consistently:
 * `Math.ceil`, never a plain round, so this can only move a payout up,
 * never down.
 */
export function uahRoundUp(value: number, rate: number | null): number | null {
  if (!rate || rate <= 0) return null;
  return Math.ceil((value * rate) / 100) * 100;
}

/**
 * Same as `uahRoundUp`, formatted — falls back to plain EUR (`formatEur`)
 * when no rate is entered.
 */
export function formatUah(value: number, rate: number | null): string {
  const uah = uahRoundUp(value, rate);
  return uah == null ? formatEur(value) : `${uah} ₴`;
}

/**
 * План-графік planned dates need date AND time (Timestamptz in the DB),
 * not just a day — these two converters are the one place that logic
 * lives, used by every planned-date `<input type="datetime-local">` this
 * feature adds. `toDatetimeLocalValue` renders a stored ISO instant into
 * the input's local wall-clock format; `fromDatetimeLocalValue` reads that
 * value back as a real ISO instant, interpreting it in the *browser's* own
 * timezone (the user's actual intent) rather than letting the server guess.
 */
export function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromDatetimeLocalValue(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
