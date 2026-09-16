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
 * "Курс EUR → UAH" (2026-09-16 user request — payroll prints should show
 * hryvnia alongside the app's own EUR figures, at whatever rate staff typed
 * in via useEurUahRate right before printing). No rate entered (null/0) ->
 * plain EUR only, same as formatEur — this never assumes a rate that wasn't
 * actually given.
 */
export function formatEurWithUah(value: number, rate: number | null): string {
  const eur = formatEur(value);
  if (!rate || rate <= 0) return eur;
  return `${eur} (${(value * rate).toFixed(2)} ₴)`;
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
