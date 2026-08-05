import { apiClient } from './http';

/**
 * Typed wrappers for backend/src/modules/ai/ (AiController, path `ai`).
 * Field shapes copied verbatim from ai/dto/*.ts and schema.prisma's
 * PendingAiAction/CompanyAiSettings/AiUsageLog models.
 *
 * Three distinct entry points, all real business logic ported from
 * Gemini.gs/AI_FullAssistant.gs (confirmed by reading ai.service.ts, not
 * guessed):
 *  - askHelp: instruction-only "Довідник" — zero live-data access, cannot
 *    hallucinate real numbers. No history/attachments.
 *  - askAboutCustomerOrder: narrowly-scoped single-turn Q&A over one
 *    specific customer order's real data. No history/attachments either.
 *  - askFullAssistant: the function-calling assistant. Carries conversation
 *    context forward via the *previous response's own* `history` field
 *    (an opaque JSON string, echoed back as `historyJson` on the next
 *    call) — the frontend must store and resend this string verbatim, not
 *    reconstruct it. Can return either a plain `answer`, or an `answer`
 *    plus a `pendingConfirmation` block when the model proposed a
 *    `critical`-flagged tool call (currently only `adjustProductStock`
 *    exists). A pendingConfirmation is NEVER executed automatically —
 *    it must be explicitly confirmed via `confirmAiAction` or dismissed via
 *    `cancelAiAction`, both keyed by the durable `PendingAiAction.id`
 *    (survives page refresh / API pod restart, confirmed from
 *    ai-actions.service.ts's header comment — this is not a client-only
 *    confirmation token).
 *
 * `recognizeInvoice` deliberately does NOT reuse the FilesModule's
 * presign-PUT-confirm upload flow (`lib/api-client/files.ts`) — the backend
 * wants the raw base64 image inline in the request body for a direct
 * multimodal model call, and never persists the image as a `FileAsset` at
 * all. So the invoice-upload page reads the file client-side via
 * `FileReader` into a base64 string itself, rather than using
 * `FileUploadField`.
 *
 * Permission notes (server-enforced only, no client-side gating — same
 * convention as every other module's permission quirks): every ask-…
 * action/settings-read endpoint requires `ai:use`; `confirm-action`
 * specifically requires the separate `ai:use-critical-actions` permission
 * (not just `ai:use` — a user can chat with the assistant and see a
 * proposed critical action without being allowed to confirm it);
 * `recognize-invoice` requires `purchase-orders:manage` (not `ai:use` —
 * it's gated by the domain the result feeds into, not the AI module
 * itself); `GET/PUT settings` requires `ai:settings-manage`.
 */

export interface AskAnswer {
  answer: string;
}

export function askHelp(question: string): Promise<AskAnswer> {
  return apiClient.post<AskAnswer>('ai/ask-help', { question });
}

export function askAboutCustomerOrder(customerOrderId: string, question: string): Promise<AskAnswer> {
  return apiClient.post<AskAnswer>('ai/ask-about-customer-order', { customerOrderId, question });
}

export interface AskFullAssistantInput {
  question: string;
  historyJson?: string;
  fileBase64?: string;
  fileMimeType?: string;
}

export interface PendingConfirmation {
  pendingActionId: string;
  action: string;
  args: Record<string, unknown>;
  description: string;
}

export interface AskFullAssistantResult {
  answer: string;
  history: string;
  pendingConfirmation?: PendingConfirmation;
}

export function askFullAssistant(dto: AskFullAssistantInput): Promise<AskFullAssistantResult> {
  return apiClient.post<AskFullAssistantResult>('ai/ask-full-assistant', dto);
}

/**
 * Result shape is whatever the confirmed tool's `execute()` returns — the
 * only critical tool today (`adjustProductStock`) returns
 * `{movement, message}`, but this is a generic per-tool contract, not a
 * fixed DTO (confirmed from ai-actions.service.ts#confirmAction, which
 * returns `tool.execute(...)`'s result verbatim). Typed loosely on purpose.
 */
export interface ConfirmAiActionResult {
  message?: string;
  [key: string]: unknown;
}

export function confirmAiAction(pendingActionId: string): Promise<ConfirmAiActionResult> {
  return apiClient.post<ConfirmAiActionResult>('ai/confirm-action', { pendingActionId });
}

export type PendingAiActionStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED';

export interface PendingAiAction {
  id: string;
  companyId: string;
  userId: string;
  actionKey: string;
  args: Record<string, unknown>;
  description: string;
  status: PendingAiActionStatus;
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
}

export function cancelAiAction(pendingActionId: string): Promise<PendingAiAction> {
  return apiClient.post<PendingAiAction>('ai/cancel-action', { pendingActionId });
}

export interface InvoiceRecognitionLine {
  rawName: string;
  qty: number;
  matched: boolean;
  article: string;
  matchedName: string;
}

export function recognizeInvoice(base64Image: string, mimeType: string): Promise<InvoiceRecognitionLine[]> {
  return apiClient.post<InvoiceRecognitionLine[]>('ai/recognize-invoice', { base64Image, mimeType });
}

/** Never carries the actual key — `hasCustomApiKey` is the only signal, matching the backend's own never-return-the-key contract. */
export interface CompanyAiSettings {
  companyId: string;
  hasCustomApiKey: boolean;
  monthlyUsageQuota: number | null;
}

export interface UpdateCompanyAiSettingsInput {
  /** Pass an empty string to clear a previously-set key and fall back to the platform key. */
  apiKey?: string;
  monthlyUsageQuota?: number;
}

export function getAiSettings(): Promise<CompanyAiSettings> {
  return apiClient.get<CompanyAiSettings>('ai/settings');
}

export function updateAiSettings(dto: UpdateCompanyAiSettingsInput): Promise<CompanyAiSettings> {
  return apiClient.put<CompanyAiSettings>('ai/settings', dto);
}
