import { SourcingOutreachStatus } from '@prisma/client';

/** Shared between the chat bot and the Mini App (2026-11-10) so both ever show the same labels/icons for the same data — "одна правда", not two copies that drift. */
export const PRICE_FIELDS = [
  { field: 'germanPriceExclVat' as const, icon: '🇩🇪', label: 'DE без ПДВ' },
  { field: 'germanPriceInclVat' as const, icon: '🇩🇪', label: 'DE з ПДВ' },
  { field: 'localPriceExclVat' as const, icon: '🇺🇦', label: 'UA без ПДВ' },
  { field: 'localPriceInclVat' as const, icon: '🇺🇦', label: 'UA з ПДВ' },
  { field: 'sellPriceEur' as const, icon: '💰', label: 'Наша ціна продажу' },
];
export type PriceField = (typeof PRICE_FIELDS)[number]['field'];

export const STATUS_LABELS: Record<SourcingOutreachStatus, string> = {
  NOT_CONTACTED: '⬜ Не написали',
  CONTACTED: '✉️ Написали',
  AWAITING_RESPONSE: '⏳ Чекаємо відповідь',
  RESPONDED: '💬 Відповіли',
  QUOTE_RECEIVED: '💰 Є ціна',
  REJECTED: '❌ Відмовили',
  WON: '🏆 Домовились',
};

export function formatPrice(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'object' && value !== null && 'toNumber' in (value as Record<string, unknown>) ? (value as { toNumber(): number }).toNumber() : Number(value);
  return `€${n.toFixed(2)}`;
}

export function priceNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'object' && value !== null && 'toNumber' in (value as Record<string, unknown>) ? (value as { toNumber(): number }).toNumber() : Number(value);
}
