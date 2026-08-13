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
