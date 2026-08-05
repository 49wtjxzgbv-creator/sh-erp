import { apiClient } from './http';

/**
 * Typed wrappers for backend/src/modules/notifications/
 * (NotificationsController, path `notifications`). Both routes require
 * `settings:manage` — the same permission that gates
 * `CompanySettings.dailyDigestEnabled`/`dailyDigestEmail` in
 * `lib/api-client/settings.ts`, since these routes act on exactly those
 * two fields.
 *
 * Only the low-stock digest exists here — ported from `dailyLowStockDigest_`
 * (Automation.gs). Confirmed from `low-stock-digest.service.ts`'s own
 * header comment: there is NO automatic daily schedule wired up anywhere in
 * this codebase (no BullMQ/Redis queue exists yet) — `sendNow` is genuinely
 * on-demand only, not "trigger the real cron job early". A true daily
 * schedule needs a new architecture decision (most likely a narrow
 * BYPASSRLS role for a background-job process, mirroring `auth_service`'s
 * own ADR-0009 pattern) that hasn't been made yet — don't build a
 * "next scheduled send" UI element, there is no schedule to show.
 */

export interface LowStockDigestContent {
  subject: string;
  body: string;
  lowStockCount: number;
  imminentForecastCount: number;
}

export function previewLowStockDigest(): Promise<LowStockDigestContent> {
  return apiClient.get<LowStockDigestContent>('notifications/low-stock-digest/preview');
}

export interface SendLowStockDigestResult {
  sent: boolean;
  reason?: string;
  content?: LowStockDigestContent;
}

/**
 * No-ops with `sent: false` and a `reason` (not an HTTP error) if the
 * digest isn't enabled or no destination email is configured in Settings —
 * confirmed from `sendDigestForCompany`'s own early-return. The UI should
 * surface `reason` as a normal inline message, not treat it as a failure.
 */
export function sendLowStockDigestNow(): Promise<SendLowStockDigestResult> {
  return apiClient.post<SendLowStockDigestResult>('notifications/low-stock-digest/send-now');
}
